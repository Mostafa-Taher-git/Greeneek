/**
 * Deep-agent Host runtime: owns the authoritative store, domain Engine,
 * durable effects and versioned policy, and exposes management Remotes.
 * It does not depend on Maestro, Fleet, or the subagent capability seam.
 */
import { Context } from '@greeneek/cordis'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { gnkHomePath } from '@greeneek/gnk-home-paths'
import { dirname, join } from 'node:path'
import { Engine, type Candidate, type Ticket } from '@greeneek/gnk-deep-agent-core'
import { DeepAgentStore, type Receipt } from '@greeneek/gnk-deep-agent-store'
import { Effects, Later } from '@greeneek/gnk-deep-agent-effects'
import { buildPolicy, type PolicySettings } from '@greeneek/gnk-deep-agent-policy'
import { SettingsStore } from './settings.ts'
import type { PromptVersionView, SettingsSaveValue, SettingsView } from './types-public.ts'
import { AgentWorkerExecutor, NoSlot, RouterSession } from '@greeneek/gnk-deep-agent-executor'
import { DiscordSource, GithubSource, SourceRegistry } from '@greeneek/gnk-deep-agent-sources'
import type { SourceHealth } from '@greeneek/gnk-deep-agent-sources/types'
import type { CredentialRef } from '@greeneek/gnk-credentials/types'
import type { DecisionInput, DecisionRow, DeepAgentState, TicketRow, TriggerInput, TriggerRow } from './types-public.ts'

export type { DecisionInput, DecisionRow, DeepAgentState, TicketRow, TriggerInput, TriggerRow } from './types-public.ts'
export type { PromptVersionView, SettingsView } from './types-public.ts'

/**
 * Decode a durable receipt into the address and text a Source can deliver.
 * @param receipt - pending outbound row from the store.
 * @returns the Source reply fields carried by the row.
 */
function replyFromReceipt(receipt: Receipt): {
  readonly id: string
  readonly text: string
  readonly address: Readonly<Record<string, string>>
  readonly source: string
} {
  const message = JSON.parse(receipt.value) as {
    readonly channel: { readonly source: string; readonly address: Readonly<Record<string, string>> }
    readonly text: string
  }
  return {
    id: receipt.id, text: message.text, address: message.channel.address, source: message.channel.source,
  }
}

declare module '@greeneek/cordis' {
  interface Context {
    /** The Deep-agent Host runtime. */
    deepAgent: DeepAgentService
  }
}

/** Emitted after any committed Deep-agent domain change. */
export const DEEP_AGENT_CHANGED = 'deep-agent/changed'

declare module '@greeneek/cordis' {
  interface Events {
    /**
     * A Deep-agent domain record changed; listeners may refresh their view.
     * @mode emit
     * @param state - the current operational summary.
     */
    'deep-agent/changed'(state: DeepAgentState): void
  }
}

/**
 * Default on-disk location of the Deep-agent domain database.
 * @returns the fully-qualified path under the Greeneek home directory.
 */
export function defaultDeepAgentDatabase(): string {
  return join(gnkHomePath(), 'deep-agent', 'orchestrator.sqlite')
}

/** Configuration for the Deep-agent runtime. */
export interface DeepAgentConfig {
  /** Absolute database path. */
  readonly database?: string
  /** Policy settings; defaults to observe mode with no admitted sources. */
  readonly policy?: PolicySettings
  /** Maximum simultaneous worker executions. */
  readonly maxWorkers?: number
  /** Root directory for per-Ticket Worker working directories. */
  readonly workerRootDirectory?: string
  /** Optional preset applied to Worker sessions. */
  readonly workerPreset?: string
  /** Optional preset applied to the Router session. */
  readonly routerPreset?: string
  /** Assessment deadline in milliseconds. */
  readonly assessmentTimeoutMs?: number
  /** GitHub source configuration. */
  readonly github?: {
    /** Credential reference holding the GitHub token. */
    readonly tokenRef?: string
    /** Repositories in owner/name form. */
    readonly repositories: readonly string[]
    /** Allowed GitHub logins; empty admits no unlisted actor. */
    readonly allowed?: readonly string[]
    /** Poll interval in seconds. */
    readonly pollSeconds?: number
  }
  /** Discord source configuration. Feishu is explicitly out of scope. */
  readonly discord?: {
    /** Credential reference holding the Discord bot token. */
    readonly tokenRef?: string
    /** Guild the configured channels belong to. */
    readonly guildId: string
    /** Channel ids the bot reads. */
    readonly channels: readonly string[]
    /** Allowed Discord user ids; empty admits no unlisted actor. */
    readonly allowed?: readonly string[]
    /** Poll interval in seconds. */
    readonly pollSeconds?: number
  }
}

const DEFAULT_POLICY: PolicySettings = {
  rules: [
    { id: 'copy', name: 'Copy fixes', enabled: true, instruction: 'Explicit requests to correct wording or punctuation.' },
  ],
  sources: {},
  mode: 'observe',
}

/** Translate a Ticket into a compact panel row. */
function ticketRow(ticket: Ticket): TicketRow {
  const report = ticket.assignments.at(-1)?.report?.state
  const stage = ticket.ended !== undefined ? 'ended' : report ?? 'queued'
  return {
    id: ticket.id,
    title: ticket.title,
    stage,
    status: ticket.ended === undefined ? 'open' : 'ended',
    ...(ticket.ended === undefined ? {} : { outcome: ticket.ended.outcome }),
    strength: ticket.mandate.strength,
    actor: ticket.mandate.actor.id,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...(ticket.attention === undefined ? {} : { attention: ticket.attention.question }),
    undelivered: ticket.undelivered.length,
  }
}

/** The Deep-agent runtime service. */
export class DeepAgentService extends TypertRemoteService {
  private readonly store: DeepAgentStore
  private readonly engine: Engine
  private readonly effects: Effects
  private readonly executor: AgentWorkerExecutor
  private readonly router: RouterSession
  private readonly sources: SourceRegistry
  private readonly bootPolicy: PolicySettings
  private readonly settingsStore: SettingsStore
  private readonly sourceConfigs: Pick<DeepAgentConfig, 'github' | 'discord'>
  private readonly dbPath: string
  private readonly workerCapacity: number
  private lastError: string | undefined

  /** @param ctx - Host context. @param config - resolved runtime config. */
  constructor(ctx: Context, config: DeepAgentConfig = {}) {
    super(ctx, 'deepAgentService', { namespace: 'deepAgent' })
    this.dbPath = config.database ?? defaultDeepAgentDatabase()
    this.bootPolicy = config.policy ?? DEFAULT_POLICY
    this.sourceConfigs = {
      ...(config.github === undefined ? {} : { github: config.github }),
      ...(config.discord === undefined ? {} : { discord: config.discord }),
    }
    this.workerCapacity = config.maxWorkers ?? 3
    this.store = new DeepAgentStore(this.dbPath)
    this.settingsStore = new SettingsStore(this.store)
    this.effects = new Effects(this.store)
    this.executor = new AgentWorkerExecutor(ctx, {
      rootDirectory: config.workerRootDirectory ?? join(dirname(this.dbPath), 'work'),
      maxWorkers: this.workerCapacity,
      ...(config.workerPreset === undefined ? {} : { workerPreset: config.workerPreset }),
      onReport: (ticketId, assignmentId, report) => {
        this.engine.report(ticketId, assignmentId, report)
        if (report.question !== undefined && report.question !== null) {
          this.engine.reply({ purpose: 'attention', ticketId, question: report.question, text: report.question })
        }
        if (report.state === 'failed' || report.state === 'blocked') {
          const attempts = (this.store.getSetting(`retry.${ticketId}`) as number | undefined) ?? 0
          if (attempts < 3) {
            this.store.setSetting(`retry.${ticketId}`, attempts + 1)
            this.effects.enqueue('retry', ticketId, { ticketId, attempts: attempts + 1 })
          }
        }
      },
      onSettled: () => { this.changed() },
      onError: (message) => { this.lastError = message },
    })
    this.engine = new Engine({
      repo: this.store.repo,
      policy: () => buildPolicy(this.policySettings()),
      scopes: {},
      assessor: {
        request: (candidate: Candidate) => {
          this.effects.enqueue('assessment', candidate.trigger.id, { triggerId: candidate.trigger.id })
        },
      },
      events: { emit: () => { this.changed() } },
      outbox: {
        send: (message) => {
          this.store.addReceipt({ id: message.id, value: JSON.stringify(message), status: 'pending' })
          this.effects.enqueue('reply', message.id, { id: message.id })
        },
      },
      executor: {
        start: (ticket, assignmentId) => {
          this.effects.enqueue('launch', assignmentId, { ticketId: ticket.id, assignmentId })
        },
        deliver: (ticket, assignmentId, inputIds) => {
          this.effects.enqueue('delivery', ticket.id, {
            ticketId: ticket.id, assignmentId, inputIds: [...inputIds],
          })
        },
        stop: (ticket, assignmentId, reason) => {
          this.effects.enqueue('stop', assignmentId, { ticketId: ticket.id, assignmentId, reason })
        },
      },
    })
    this.router = new RouterSession(ctx, {
      sessionKey: 'router.sessionId',
      readSessionId: key => this.store.getSetting(key),
      writeSessionId: (key, value) => { this.store.setSetting(key, value) },
      ...(config.routerPreset === undefined ? {} : { routerPreset: config.routerPreset }),
      ...(config.assessmentTimeoutMs === undefined ? {} : { assessmentTimeoutMs: config.assessmentTimeoutMs }),
      onDecision: (triggerId, outcome) => { this.engine.decide(triggerId, outcome) },
    })
    this.effects.on('assessment', (value) => {
      const { triggerId } = value as { triggerId: string }
      const candidate = this.engine.candidate(triggerId)
      if (candidate === undefined) return
      void this.router.assess(candidate).catch(() => { /* an expired Eval is retried by the domain clock */ })
    })
    this.effects.on('launch', async (value) => {
      const { ticketId, assignmentId } = value as { ticketId: string; assignmentId: string }
      const ticket = this.store.repo.tickets.get(ticketId)
      if (ticket === undefined) return
      try {
        await this.executor.launchAssignment(ticket, assignmentId)
      } catch (error: unknown) {
        if (error instanceof NoSlot) throw new Later('worker capacity is full')
        throw error
      }
    })
    this.effects.on('delivery', (value) => {
      const { ticketId, assignmentId, inputIds } = value as {
        ticketId: string
        assignmentId?: string
        inputIds?: readonly string[]
      }
      const ticket = this.store.repo.tickets.get(ticketId)
      if (ticket === undefined || assignmentId === undefined || inputIds === undefined) return
      this.executor.deliver(ticket, assignmentId, inputIds)
    })
    this.effects.on('stop', (value) => {
      const { ticketId, assignmentId, reason } = value as { ticketId: string; assignmentId: string; reason: string }
      const ticket = this.store.repo.tickets.get(ticketId)
      if (ticket === undefined) return
      this.executor.stop(ticket, assignmentId, reason)
    })
    this.effects.on('retry', (value) => {
      const { ticketId } = value as { ticketId: string }
      this.engine.retryTicket(ticketId)
    })
    this.effects.on('notice', (value) => {
      const { value: text, summary } = value as { value: string; summary: string }
      void this.router.relay(text, summary).catch(() => { /* a dropped notice stays in the effect log */ })
    })
    this.sources = new SourceRegistry([
      ...(config.github === undefined ? [] : [new GithubSource(ctx, this.store, {
        tokenRef: (config.github.tokenRef ?? 'GITHUB_TOKEN') as CredentialRef,
        repositories: config.github.repositories,
        allowed: config.github.allowed ?? [],
        pollSeconds: config.github.pollSeconds ?? 60,
      })]),
      ...(config.discord === undefined ? [] : [new DiscordSource(ctx, this.store, {
        tokenRef: (config.discord.tokenRef ?? 'DISCORD_BOT_TOKEN') as CredentialRef,
        guildId: config.discord.guildId,
        channels: config.discord.channels,
        allowed: config.discord.allowed ?? [],
        pollSeconds: config.discord.pollSeconds ?? 60,
      })]),
    ], (trigger) => { this.engine.receive(trigger) })
    this.effects.on('reply', (value) => {
      const { id } = value as { id: string }
      const receipt = this.store.pendingReceipts().find(item => item.id === id)
      if (receipt === undefined) return
      this.sources.enqueueReply(replyFromReceipt(receipt))
    })
    ctx.effect(() => async () => {
      await this.executor.dispose()
      await this.router.dispose()
      this.store.close()
    }, 'deep-agent: worker, router and store close')
  }

  /**
   * Record an infrastructure failure for the operational summary.
   * @param message - the failure text.
   */
  recordError(message: string): void {
    this.lastError = message
  }

  /**
   * Start periodic source polling with the configured minimum interval.
   * @returns disposer that stops polling.
   */
  startSourcePolling(): () => void {
    const intervals = [
      ...(this.sourceConfigs.github?.pollSeconds === undefined ? [] : [this.sourceConfigs.github.pollSeconds]),
      ...(this.sourceConfigs.discord?.pollSeconds === undefined ? [] : [this.sourceConfigs.discord.pollSeconds]),
    ]
    const seconds = intervals.length === 0 ? 60 : Math.min(...intervals)
    return this.sources.start(seconds * 1_000)
  }

  /** Resume Workers whose assignments were running before this boot. */
  async recover(): Promise<void> {
    await this.executor.recover(this.store.repo.tickets.open())
    for (const receipt of this.store.pendingReceipts()) {
      this.sources.enqueueReply(replyFromReceipt(receipt))
      this.effects.enqueue('reply', receipt.id, { id: receipt.id })
    }
    this.changed()
  }

  /**
   * Current Worker capacity from the real slot registry.
   * @returns used and free slot counts.
   */
  capacity(): { readonly used: number; readonly free: number } {
    return this.executor.capacity()
  }

  /** Current policy from persisted settings, falling back to boot config before the first save. */
  private policySettings(): PolicySettings {
    const view = this.settingsStore.settings()
    if (view.revision === 0) return this.bootPolicy
    return {
      rules: view.rules,
      sources: view.sources,
      mode: view.mode,
      paused: view.paused,
    }
  }

  /** Current operational summary from durable state. */
  private summary(): DeepAgentState {
    const threads = this.store.repo.threads
    const tickets = this.store.repo.tickets
    const policy = buildPolicy(this.policySettings())
    return {
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      configured: Object.keys(this.policySettings().sources).length > 0,
      paused: policy.paused,
      policyVersion: policy.version,
      mode: this.policySettings().mode,
      counts: {
        triggers: this.store.triggerCount(),
        threads: threads.list().length,
        tickets: tickets.list().length,
        openTickets: tickets.open().length,
        decisions: this.store.decisionCount(),
        pendingEffects: this.store.dueEffects('reply', 1_000, '9999-12-31T00:00:00.000Z').length
          + this.store.dueEffects('launch', 1_000, '9999-12-31T00:00:00.000Z').length
          + this.store.dueEffects('assessment', 1_000, '9999-12-31T00:00:00.000Z').length,
      },
    }
  }

  private changed(): void {
    this.ctx.emit(DEEP_AGENT_CHANGED, this.summary())
  }

  /** Close the owned store; called by the Host effect disposer and by tests. */
  close(): void {
    this.store.close()
  }

  /**
   * Current operational state.
   * @returns the state summary.
   */
  @Remote('state')
  state(): DeepAgentState {
    return this.summary()
  }

  /**
   * All durable Tickets, newest last.
   * @returns compact Ticket rows.
   */
  @Remote('tickets')
  tickets(): readonly TicketRow[] {
    return this.store.repo.tickets.list().map(ticketRow)
  }

  /**
   * All recorded Decisions.
   * @returns compact Decision rows.
   */
  @Remote('decisions')
  decisions(): readonly DecisionRow[] {
    const rows: DecisionRow[] = []
    for (const thread of this.store.repo.threads.list()) {
      for (const decision of this.store.repo.decisions.byThread(thread.key)) {
        rows.push({
          id: decision.id, kind: decision.kind, at: decision.at, threadKey: thread.key,
          reasons: decision.reason.map(item => item.code),
          ...(decision.ticketId === undefined ? {} : { ticketId: decision.ticketId }),
        })
      }
    }
    return rows
  }

  /**
   * Recent Triggers with their dispositions.
   * @returns Trigger rows.
   */
  @Remote('triggers')
  triggers(): readonly TriggerRow[] {
    const rows: TriggerRow[] = []
    for (const thread of this.store.repo.threads.list()) {
      const ids = [...new Set([...thread.pending, ...thread.evaluating?.triggerIds ?? []])]
      for (const id of ids) {
        const stored = this.store.repo.triggers.get(id)
        if (stored === undefined) continue
        const disposition = this.store.repo.triggers.disposition(id)
        rows.push({
          id: stored.id,
          source: stored.source,
          actor: stored.actor.id,
          human: stored.human,
          at: stored.at,
          text: stored.text.slice(0, 2_000),
          threads: stored.threads.map(item => `${item.source}:${item.id}`),
          ...(disposition?.evalId === undefined ? {} : { evalId: disposition.evalId }),
          fanout: [...disposition?.fanout ?? []],
        })
      }
    }
    return rows
  }

  /**
   * Ingest one event from a human operator into the domain.
   * @param request - wire-safe Trigger fields.
   * @returns whether the event was received, duplicate or filtered.
   */
  @Remote('receive')
  receive(request: TriggerInput): 'received' | 'duplicate' | 'filtered' {
    return this.engine.receive({
      id: request.id,
      source: request.source,
      threads: request.threads.map(item => ({ source: item.source, id: item.id })),
      actor: request.actor,
      human: request.human,
      ...(request.addressed === undefined ? {} : { addressed: request.addressed }),
      at: request.at,
      text: request.text,
      ...(request.channel === undefined ? {} : { channel: request.channel }),
      meta: {},
    })
  }

  /**
   * Run one domain clock pass: expire overdue Evals and start due ones.
   * @returns the number of Evals started.
   */
  @Remote('evaluateDue')
  evaluateDue(): number {
    const before = this.store.repo.decisions.byThread('').length
    this.engine.evaluateDue()
    return this.store.repo.decisions.byThread('').length - before
  }

  /**
   * Record an operator decision for a candidate event.
   * @param request - trigger id and assessment outcome.
   * @returns the recorded Decision id.
   */
  @Remote('decide')
  decide(request: DecisionInput): string {
    const decision = this.engine.decide(request.triggerId, {
      accept: request.accept,
      reason: request.reason,
      ...(request.evalId === undefined ? {} : { evalId: request.evalId }),
      ...(request.matchedRules === undefined ? {} : { matchedRules: [...request.matchedRules] }),
    })
    return decision.id
  }

  /**
   * Current editable settings document.
   * @returns the settings with its revision.
   */
  @Remote('settings')
  settings(): SettingsView {
    return this.settingsStore.settings()
  }

  /**
   * Save one settings block with optimistic concurrency.
   * @param request - block name, wire-safe value and expected revision.
   * @returns the saved settings with the new revision.
   */
  @Remote('saveSettings')
  saveSettings(request: { readonly block: 'policy' | 'eval' | 'executor' | 'sources' | 'pause'; readonly value: SettingsSaveValue; readonly revision: number }): SettingsView {
    const saved = this.settingsStore.save(request.block, request.value, request.revision)
    this.changed()
    return saved
  }

  /**
   * Current prompt texts, including built-ins.
   * @returns one row per prompt name.
   */
  @Remote('prompts')
  prompts(): readonly PromptVersionView[] {
    return this.settingsStore.prompts()
  }

  /**
   * Save a new immutable prompt version.
   * @param request - prompt name and text.
   * @returns the saved version.
   */
  @Remote('savePrompt')
  savePrompt(request: { readonly name: string; readonly text: string }): PromptVersionView {
    return this.settingsStore.savePrompt(request.name, request.text)
  }

  /**
   * Immutable history of one prompt.
   * @param request - prompt name.
   * @returns versions newest first.
   */
  @Remote('promptHistory')
  promptHistory(request: { readonly name: string }): readonly PromptVersionView[] {
    return this.settingsStore.promptHistory(request.name)
  }

  /**
   * Restore a prompt to its built-in text as a new version.
   * @param request - prompt name.
   * @returns the restored version.
   */
  @Remote('resetPrompt')
  resetPrompt(request: { readonly name: string }): PromptVersionView {
    return this.settingsStore.resetPrompt(request.name)
  }

  /**
   * Stop a Ticket and withdraw its Mandate.
   * @param request - ticket id and optional reason.
   */
  @Remote('stopTicket')
  stopTicket(request: { ticketId: string; reason?: string }): void {
    this.engine.stopTicket(request.ticketId, request.reason)
  }

  /**
   * Retry a blocked or failed Ticket under the same Mandate.
   * @param request - ticket id.
   */
  @Remote('retryTicket')
  retryTicket(request: { ticketId: string }): void {
    this.engine.retryTicket(request.ticketId)
  }

  /**
   * Host path of the domain database, for the deployment panel.
   * @returns the absolute database path.
   */
  @Remote('databasePath')
  databasePath(): string {
    return this.dbPath
  }

  /**
   * Configured worker capacity.
   * @returns the maximum simultaneous workers.
   */
  @Remote('maxWorkers')
  maxWorkers(): number {
    return this.workerCapacity
  }

  /**
   * Current Worker slot usage.
   * @returns used and free slot counts.
   */
  @Remote('workerCapacity')
  workerCapacityState(): { readonly used: number; readonly free: number } {
    return this.capacity()
  }

  /**
   * Durable id of the main Router session.
   * @returns the session id, or an empty string before first boot.
   */
  @Remote('routerSessionId')
  routerSessionId(): string {
    return this.router.sessionId() ?? ''
  }

  /**
   * Health of configured source adapters.
   * @returns one health record per configured Source.
   */
  @Remote('sourceHealth')
  sourceHealth(): readonly SourceHealth[] {
    return this.sources.health()
  }

  /** Run one source polling pass and deliver queued replies. */
  @Remote('pollSources')
  async pollSources(): Promise<void> {
    await this.sources.pollOnce()
    this.changed()
  }
}

/** Loader identity of the Deep-agent Host plugin. */
export const name = 'deep-agent'

/** Services the Router and Worker sessions own through this plugin fiber. */
export const inject = ['agents', 'credentials']

/** Host plugin body: provide the Deep-agent service as a Cordis service. */
export function apply(ctx: Context, config: DeepAgentConfig = {}): void {
  const service = new DeepAgentService(ctx, config)
  // Recovery opens SQLite. Defer it to the first async Consumer call so a
  // process that only boots the Web host does not load node:sqlite at startup.
  let recovery: Promise<void> | undefined
  let stopPolling: (() => void) | undefined
  const ready = (): Promise<void> => {
    recovery ??= service.recover()
      .then(() => { stopPolling = service.startSourcePolling() })
      .catch((error: unknown) => {
        service.recordError(error instanceof Error ? error.message : String(error))
      })
    return recovery
  }
  const lazy = new Proxy(service, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (property === 'recover' || typeof value !== 'function') return value
      const fn = value as (...values: unknown[]) => unknown
      if (fn.constructor.name !== 'AsyncFunction') return value
      return (...args: unknown[]) => ready().then(() => fn.apply(target, args))
    },
  })
  ctx.provide('deepAgent', lazy)
  ctx.effect(() => () => { stopPolling?.() }, 'deep-agent: source polling')
}

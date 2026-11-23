/**
 * Deep-agent Host runtime: owns the authoritative store, domain Engine,
 * durable effects and versioned policy, and exposes management Remotes.
 * It does not depend on Maestro, Fleet, or the subagent capability seam.
 */
import { Context } from '@greeneek/cordis'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { gnkHomePath } from '@greeneek/gnk-home-paths'
import { join } from 'node:path'
import { Engine, type Candidate, type Ticket } from '@greeneek/gnk-deep-agent-core'
import { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import { Effects } from '@greeneek/gnk-deep-agent-effects'
import { buildPolicy, type PolicySettings } from '@greeneek/gnk-deep-agent-policy'
import type { DecisionRow, DeepAgentState, TicketRow, TriggerRow } from './types.ts'

export type { DecisionRow, DeepAgentState, TicketRow, TriggerRow } from './types.ts'

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

/** Default on-disk location of the Deep-agent domain database. */
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
  private readonly settings: PolicySettings
  private readonly dbPath: string
  private readonly workerCapacity: number

  /** @param ctx - Host context. @param config - resolved runtime config. */
  constructor(ctx: Context, config: DeepAgentConfig = {}) {
    super(ctx, 'deepAgentService', { namespace: 'deepAgent' })
    this.dbPath = config.database ?? defaultDeepAgentDatabase()
    this.settings = config.policy ?? DEFAULT_POLICY
    this.workerCapacity = config.maxWorkers ?? 3
    this.store = new DeepAgentStore(this.dbPath)
    const policy = buildPolicy(this.settings)
    this.engine = new Engine({
      repo: this.store.repo,
      policy: () => buildPolicy(this.settings),
      scopes: {},
      assessor: {
        request: (candidate: Candidate) => {
          this.effects.enqueue('assessment', candidate.trigger.id, { triggerId: candidate.trigger.id })
        },
      },
      events: { emit: () => { this.changed() } },
      outbox: {
        send: (message) => {
          this.store.addReceipt({
            id: message.id, value: JSON.stringify(message), status: 'pending',
          })
          this.effects.enqueue('reply', message.id, { id: message.id })
        },
      },
      executor: {
        start: (ticket, assignmentId) => {
          this.effects.enqueue('launch', assignmentId, { ticketId: ticket.id, assignmentId })
        },
        deliver: (ticket, assignmentId, inputIds) => {
          this.effects.enqueue('delivery', ticket.id, { ticketId: ticket.id })
          void assignmentId
          void inputIds
        },
        stop: (ticket, assignmentId, reason) => {
          this.effects.enqueue('notice', `${ticket.id}:${assignmentId}`, { value: reason, summary: reason })
        },
      },
    })
    this.effects = new Effects(this.store)
    // Handlers are attached after construction because the Engine closes over `this.effects`.
    this.effects.on('assessment', () => { /* the Router assessor consumes this effect in a later phase */ })
    this.effects.on('reply', () => { /* the Source channel delivers receipts in a later phase */ })
    this.effects.on('notice', () => { /* the Router relays notices in a later phase */ })
    void policy
    ctx.effect(() => () => { this.store.close() }, 'deep-agent: store close')
  }

  /** Current operational summary from durable state. */
  private summary(): DeepAgentState {
    const threads = this.store.repo.threads
    const tickets = this.store.repo.tickets
    const policy = buildPolicy(this.settings)
    return {
      configured: Object.keys(this.settings.sources).length > 0,
      paused: policy.paused,
      policyVersion: policy.version,
      mode: this.settings.mode,
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
      for (const id of thread.pending) {
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
}

/** Loader identity of the Deep-agent Host plugin. */
export const name = 'deep-agent'

/** Host plugin body: provide the Deep-agent service as a Cordis service. */
export function apply(ctx: Context, config: DeepAgentConfig = {}): void {
  const service = new DeepAgentService(ctx, config)
  ctx.provide('deepAgent', service)
}

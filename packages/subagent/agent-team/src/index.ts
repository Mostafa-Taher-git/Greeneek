/** Agent Teams service façade over roster, mailbox, task, and runtime lifecycle owners. */

import { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type { Agent } from '@greeneek/gnk-agent'
import { resolveGnkHome } from '@greeneek/gnk-home-paths'
import type { SessionEvent, TurnEndReason } from '@greeneek/gnk-session'
import type { SessionId } from '@greeneek/gnk-session/types'
import type {} from '@greeneek/gnk-session-persistence'
import type { SettingsProvider, SettingsScope } from '@greeneek/gnk-settings'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { TeamActivity } from './activity.ts'
import { runDebate } from './debate.ts'
import type { DebatePorts, DebateRequest, DebateResult } from './debate.ts'
import { errorMessage, TeamError } from './error.ts'
import { HarnessRegistry } from './harness-registry.ts'
import type { HarnessDescriptor } from './harness-descriptor.ts'
import { RepoFleetConfigStore } from './fleet-config.ts'
import type { RepoFleetSnapshot } from './fleet-config.ts'
import { GREENEEK_HARNESS, migrateFleetSettings } from './fleet-migration.ts'
import {
  assertFavoriteProviderReady,
  duplicateFleetFavorite,
  fleetStarterTemplates,
  favoriteMemberRequest,
  fleetConcurrency,
  FLEET_SETTINGS_NAMESPACE,
  FleetSettingsSchema,
  fleetProviderAvailability,
  isFleetEnabled,
  starterFleet,
  validateFleetFavorite,
  validateFleetSettings,
} from './fleet-settings.ts'
import type {
  FleetFavorite,
  FleetFavoriteResult,
  FleetFavoritesView,
  FleetLaunchResult,
  FleetProviderAvailability,
  FleetSettings,
} from './fleet-settings.ts'
import { LaneIntegration } from './integration.ts'
import type { LaneGateCommand, LaneMergeResult } from './integration.ts'
import { TeamJournal } from './journal.ts'
import { LaneLifecycleManager } from './lane-lifecycle.ts'
import type { LaneCheckpoint, LaneRecord } from './lane-lifecycle.ts'
import type { LanePolicy } from './lane-policy.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamMailbox } from './mailbox.ts'
import { readPersistedSession } from './persisted.ts'
import { teamProjectionDefinition } from './projection.ts'
import { TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberSettled,
  TeamMemberView,
  TeamTaskMutationResult,
  TeamTaskView,
  TeamView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
} from './types.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'
export { RepoFleetConfigStore } from './fleet-config.ts'
export type { RepoFleetConfig, RepoFleetConfigOptions, RepoFleetMember, RepoFleetSnapshot } from './fleet-config.ts'
export {
  GREENEEK_HARNESS,
  LEGACY_GREENEEK_STRATEGIES,
  migrateFleetMember,
  migrateFleetSettings,
  userFacingConnection,
} from './fleet-migration.ts'
export {
  assertFavoriteProviderReady,
  FLEET_SETTINGS_NAMESPACE,
  FleetSettingsSchema,
  fleetProviderAvailability,
  validateFleetFavorite,
  validateFleetSettings,
} from './fleet-settings.ts'
export type {
  FleetFavorite,
  FleetFavoriteMember,
  FleetFavoriteResult,
  FleetFavoritesView,
  FleetLaunchResult,
  FleetProviderAvailability,
  FleetProviderState,
  FleetSettings,
} from './fleet-settings.ts'
export { LaneIntegration } from './integration.ts'
export type {
  LaneGateCommand,
  LaneGateEvidence,
  LaneGateRunner,
  LaneIntegrationOptions,
  LaneMergeRequest,
  LaneMergeResult,
} from './integration.ts'
export { LaneLifecycleManager, LaneName } from './lane-lifecycle.ts'
export type { LaneCheckpoint, LaneCreateRequest, LaneLifecycleManagerOptions, LaneRecord, LaneStage } from './lane-lifecycle.ts'
export { assertDisjointLaneScopes, resolveLanePolicy } from './lane-policy.ts'
export type { ActiveLaneScope, LanePolicy, LanePolicyRequest } from './lane-policy.ts'
export { GitRevision, WorktreeError, WorktreeManager } from './worktrees.ts'
export type {
  LaneWorktree,
  LaneWorktreeListRequest,
  LaneWorktreeRequest,
  WorktreeErrorCode,
  WorktreeGitInvocation,
  WorktreeGitRunner,
  WorktreeManagerOptions,
} from './worktrees.ts'

declare module '@greeneek/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const DEFAULT_MAX_MEMBERS = 8
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_MAX_LANE_PATCH_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_FLEET_CONFIG_BYTES = 65_536

/** Outcome of starting one fleet member inside a launch batch. */
type FleetMemberOutcome
  = { readonly ok: true; readonly member: TeamMemberView }
  | { readonly ok: false; readonly name: string; readonly message: string }

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/**
 * Describe one turn's terminal reason for a named debate seat failure.
 * @param reason - the terminal reason recorded on the child's `turn/end`.
 * @returns a short phrase naming the stop condition.
 */
function describeTurnEnd(reason: TurnEndReason): string {
  switch (reason.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'reached the output-token limit'
    case 'aborted':
      return 'was aborted'
    case 'blocked':
      return 'was blocked'
    case 'interrupted':
      return 'was interrupted'
    case 'error':
      return `failed: ${reason.error.message}`
    // TurnEndReasonMap is merge-extensible; an unknown ending must not read
    // as a completed reply.
    default:
      return 'ended before a reply'
  }
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxPendingMessagesPerMember: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
    gnkHome: z.string().default(resolveGnkHome(undefined, process.env)),
    maxLanePatchBytes: z.number().step(1).min(1).default(DEFAULT_MAX_LANE_PATCH_BYTES),
    maxFleetConfigBytes: z.number().step(1).min(1).default(DEFAULT_MAX_FLEET_CONFIG_BYTES),
    /**
     * Providers a fleet may name. The default `[]` admits every registered
     * provider that can hold a Team lane, so mounting an external CLI adapter
     * makes its members valid without the fleet layer naming providers itself; a
     * non-empty list narrows fleets to exactly those providers.
     */
    fleetProviders: z.array(z.string()).default([]),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly lanes: LaneLifecycleManager
  private readonly integration: LaneIntegration
  private readonly fleet: RepoFleetConfigStore
  private fleetSettings: SettingsScope<FleetSettings> | undefined
  private settingsProvider: SettingsProvider | undefined
  private readonly roster: TeamRoster
  private readonly mailbox: TeamMailbox
  private readonly tasks: TeamTaskBoard
  private readonly harnessesRegistry: HarnessRegistry

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxPendingMessagesPerMember: positiveLimit(
        'maxPendingMessagesPerMember',
        config.maxPendingMessagesPerMember ?? DEFAULT_MAX_PENDING_MESSAGES,
      ),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
      gnkHome: config.gnkHome ?? resolveGnkHome(undefined, process.env),
      maxLanePatchBytes: positiveLimit(
        'maxLanePatchBytes',
        config.maxLanePatchBytes ?? DEFAULT_MAX_LANE_PATCH_BYTES,
      ),
      maxFleetConfigBytes: positiveLimit(
        'maxFleetConfigBytes',
        config.maxFleetConfigBytes ?? DEFAULT_MAX_FLEET_CONFIG_BYTES,
      ),
      fleetProviders: config.fleetProviders ?? [],
    }

    if (this.config.fleetProviders.some(provider => provider.trim().length === 0)) {
      throw new TeamError('fleetProviders must not contain a blank provider name', 'TEAM_INVALID_CONFIG')
    }

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.lanes = new LaneLifecycleManager({
      gnkHome: this.config.gnkHome,
      maxPatchBytes: this.config.maxLanePatchBytes,
    })
    this.integration = new LaneIntegration({ lanes: this.lanes })
    this.fleet = new RepoFleetConfigStore({
      gnkHome: this.config.gnkHome,
      maxBytes: this.config.maxFleetConfigBytes,
      ...this.config.fleetProviders.length === 0
        ? { resolveAllowedProviders: () => this.admittedProviders() }
        : { allowedProviders: this.config.fleetProviders },
    })
    ctx.inject(['settings'], (settingsCtx) => {
      this.settingsProvider = settingsCtx.settings
      this.fleetSettings = settingsCtx.settings.register(
        FLEET_SETTINGS_NAMESPACE,
        FleetSettingsSchema,
        { validate: validateFleetSettings },
      )
      settingsCtx.effect(() => () => {
        this.fleetSettings = undefined
        this.settingsProvider = undefined
      }, 'agentTeams.fleetSettings()')
    })
    this.roster = new TeamRoster(
      ctx,
      this.journal,
      this.lifecycle,
      this.lanes,
      this.config.maxMembers,
      // The mailbox owns durable queueing and dispatch, so the roster's settlement
      // report is authored there. The reference resolves at settlement, after this
      // constructor has assigned the mailbox.
      (root, member) => this.mailbox.reportSettledMember(root, member),
    )
    this.mailbox = new TeamMailbox(
      ctx,
      this.journal,
      this.roster,
      this.lifecycle,
      this.config.maxPendingMessagesPerMember,
      this.config.maxMessageBytes,
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)
    this.harnessesRegistry = new HarnessRegistry(ctx, this.config.fleetProviders)

    ctx.on('session/event', (session, event) => { this.mailbox.observeSessionEvent(session, event) })
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (this.roster.enforceTokenBudget(agent)) return { kind: 'reject' }
      return await next()
    })
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.effect(() => {
      const disposeProjection = ctx.root.sessionProjections.register(teamProjectionDefinition)
      return async () => {
        try {
          await this.disposeRuntime()
        } finally {
          disposeProjection()
        }
      }
    }, 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   *
   * The request may name the Greeneek Harness connection; the registry resolves
   * it to the internal execution strategy that honors the requested context
   * before the roster records the child under that strategy's registry name.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    const selection = this.harnessesRegistry.select(request.provider, {
      ...request.agentOptions?.model === undefined ? {} : { model: request.agentOptions.model },
      ...request.agentOptions?.reasoningEffort === undefined ? {} : { reasoningEffort: String(request.agentOptions.reasoningEffort) },
      context: request.context,
    })
    if (selection.kind === 'refused') {
      throw new TeamError(selection.reason, selection.code)
    }
    const provider = this.harnessesRegistry.resolveConnection(request.provider, request.context)
    return await this.roster.spawn(caller, { ...request, provider })
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    return await this.mailbox.send(caller, request)
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Run a genuine multi-Harness debate: spawn seats over roster lanes,
   * feed each round's transcript through the durable mailbox, collect each
   * seat's next full reply from its own Session log, and synthesize the
   * transcript with the dedicated moderator seat. The run covers Independent
   * Proposals, Cross-Examination, Rebuttal, Evidence Review, and Final
   * Synthesis, and publishes one of four verdicts with unresolved
   * disagreements and any minority evidence a majority must not certify away.
   * Every seat name, the moderator name, the roster seats the debate needs,
   * and the registered provider are checked before the first seat exists, so
   * a refused debate leaves no half-populated roster behind. A seat's reply is
   * the turn that answers the prompt the debate queued for it: an inherited
   * fork prefix and a reply that settled earlier cannot answer it.
   * @param caller - exact live Team Lead Agent.
   * @param request - topic, seats, moderator, rounds, and caller cancellation.
   * @returns full transcript, synthesis, verdict, and per-seat failures.
   */
  async conductDebate(caller: Agent, request: DebateRequest): Promise<DebateResult> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can conduct a debate', 'TEAM_LEAD_REQUIRED')
    }
    if (request.participants.length === 0) {
      throw new TeamError('debate requires at least one participant', 'TEAM_INVALID_ARGUMENT')
    }
    const maxRounds = request.maxRounds ?? 1
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 0) {
      throw new TeamError('debate maxRounds must be a non-negative integer', 'TEAM_INVALID_ARGUMENT')
    }
    const participantNames = request.participants.map(seat => seat.name ?? seat.provider)
    const repeatedName = participantNames.find((candidate, index) => participantNames.indexOf(candidate) !== index)
    if (repeatedName !== undefined) {
      throw new TeamError(
        `debate participants need distinct speaking names; "${repeatedName}" is used twice`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const moderatorSpec = request.moderator ?? { provider: 'spawn', name: 'moderator' }
    const moderatorName = moderatorSpec.name ?? moderatorSpec.provider
    if (participantNames.includes(moderatorName)) {
      throw new TeamError(
        `debate moderator name "${moderatorName}" must differ from every participant name`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    // A debate consumes one immutable roster seat per participant plus one for
    // the moderator. Refuse reuse and exhaustion before the first seat exists,
    // so a failed debate leaves no half-populated roster behind.
    const rosterNames = new Set(
      this.roster.list(membership).filter(row => row.role === 'teammate').map(row => row.name),
    )
    const reused = [...participantNames, moderatorName].find(name => rosterNames.has(name))
    if (reused !== undefined) {
      throw new TeamError(
        `debate seat "${reused}" reuses a teammate name already in this Team; give each debate distinct speaking names`,
        'TEAM_MEMBER_NAME_TAKEN',
      )
    }
    const debateSeats = participantNames.length + 1
    if (rosterNames.size + debateSeats > this.config.maxMembers) {
      throw new TeamError(
        `debate needs ${debateSeats} new roster seats but this Team has ${rosterNames.size} of ${this.config.maxMembers} members; run the debate in a new session or raise maxMembers`,
        'TEAM_MEMBER_LIMIT',
      )
    }
    // Multi-round debate needs continuable lanes per seat; one-shot members
    // settle once and cannot receive follow-ups. Refuse upfront by name,
    // before spawning anything, rather than fail mid-debate.
    if (maxRounds > 0) {
      const lanes = this.continuableProviders()
      for (const seat of request.participants) {
        const name = seat.name ?? seat.provider
        const resolved = this.harnessesRegistry.resolveConnection(seat.provider, 'fresh')
        if (!lanes.has(resolved)) {
          throw new TeamError(
            `debate seat "${name}" names provider "${seat.provider}", which cannot hold a continuable lane for multi-round debate`,
            'TEAM_DEBATE_NOT_CONTINUABLE',
          )
        }
      }
    }
    const childIds = new Map<string, SessionId>()
    // Persisted log length observed immediately before each prompt is queued.
    // Collection reads the turn that starts at or after this offset, so a
    // fast reply or a fork prefix appended after the request can never stand
    // in for the reply to this prompt.
    const boundaries = new Map<string, number>()
    const ports: DebatePorts = {
      spawn: async (provider, name, prompt, signal) => {
        if (childIds.has(name)) {
          throw new TeamError(`teammate name "${name}" was already used in this Team`, 'TEAM_MEMBER_NAME_TAKEN')
        }
        boundaries.set(name, 0)
        const view = await this.spawnTeammate(caller, {
          name,
          description: 'debate participant',
          prompt: [{ type: 'text', text: prompt }],
          context: 'fresh',
          provider,
          signal,
        })
        childIds.set(name, view.member.id)
      },
      send: async (target, content, signal) => {
        const childId = childIds.get(target)
        if (childId === undefined) {
          throw new TeamError(`debate seat "${target}" has no live member`, 'TEAM_MEMBER_NOT_FOUND')
        }
        const before = await readPersistedSession(this.ctx.sessionPersistence, childId, signal)
        boundaries.set(target, before.events.length)
        await this.sendMessage(caller, {
          target,
          content: [{ type: 'text', text: content }],
          signal,
        })
      },
      collect: async (name, signal) => {
        const childId = childIds.get(name)
        if (childId === undefined) {
          throw new TeamError(`debate seat "${name}" has no live member`, 'TEAM_MEMBER_NOT_FOUND')
        }
        return await this.collectSeatReplies(caller, name, childId, boundaries.get(name) ?? 0, signal)
      },
      dispose: async (name) => {
        const childId = childIds.get(name)
        if (childId === undefined) return
        await this.roster.stopTeammates(caller, [childId])
      },
    }
    return await runDebate(ports, request)
  }

  /**
   * Collect the reply to the prompt queued at `boundary`. Only a turn that
   * starts at or after that persisted offset can answer the prompt, so an
   * inherited fork prefix or a reply that settled before collection began
   * cannot stand in for the current turn.
   * @param caller - exact live Team Lead in whose Team the debate runs.
   * @param name - participant member name.
   * @param childId - child session holding the ongoing conversation.
   * @param boundary - persisted log length observed immediately before the prompt was queued.
   * @param signal - caller cancellation for the whole wait.
   * @returns the participant's full reply text for the requested turn.
   */
  private async collectSeatReplies(
    caller: Agent,
    name: string,
    childId: SessionId,
    boundary: number,
    signal: AbortSignal,
  ): Promise<string> {
    const state = this.journal.state(caller)
    const row = state.members.find(candidate => candidate.id === childId)
    if (row === undefined) {
      throw new TeamError(`debate seat "${name}" has no live member`, 'TEAM_MEMBER_NOT_FOUND')
    }
    if (row.phase === 'failed') {
      throw new TeamError(`debate seat "${name}" failed mid-debate: ${row.error ?? 'unknown error'}`, 'TEAM_DEBATE_MEMBER_FAILED')
    }
    const replyText = (events: readonly SessionEvent[], turn: number, base: number): string | undefined => {
      const parts: string[] = []
      for (const event of events) {
        if (event.type !== 'assistant/message') continue
        if (event.data.turn !== turn || event.seq < base) continue
        for (const block of event.data.message.content) {
          if (block.type === 'text') parts.push(block.text)
        }
      }
      const text = parts.join('\n').trim()
      return text.length === 0 ? undefined : text
    }
    // Bound for a lane that is idle with no new assistant reply: persistence
    // lag needs a grace of several seconds, but an indefinitely idle lane
    // must fail named rather than hang the round until caller abort.
    const IDLE_POLL_LIMIT = 100
    let idleStreak = 0
    while (true) {
      signal.throwIfAborted()
      const stateNow = this.journal.state(caller)
      const current = stateNow.members.find(candidate => candidate.id === childId)
      if (current?.phase === 'failed') {
        throw new TeamError(
          `debate seat "${name}" failed mid-debate: ${current.error ?? 'unknown error'}`,
          'TEAM_DEBATE_MEMBER_FAILED',
        )
      }
      const live = this.ctx.agents.get(childId)
      if (live !== undefined && live.status === 'running') {
        idleStreak = 0
        // Turn still active: wait for the driver to go idle before judging
        // the turn's terminal record.
        await new Promise<void>(resolve => setTimeout(resolve, 50))
        continue
      }
      const stored = await readPersistedSession(this.ctx.sessionPersistence, childId, signal)
      // A fork child records its inherited prefix before its own turns; those
      // prefix events carry the parent's turn numbers and assistant messages,
      // so both the captured request boundary and the durable inheritance
      // boundary must be excluded from this turn's reply.
      const base = Math.max(boundary, stored.inheritedEventCount)
      const start = stored.events.find(
        (event): event is SessionEvent<'turn/start'> => event.type === 'turn/start' && event.seq >= base,
      )
      if (start !== undefined) {
        const turn = start.data.turn
        const end = stored.events.find(
          (event): event is SessionEvent<'turn/end'> => event.type === 'turn/end' && event.data.turn === turn,
        )
        if (end !== undefined) {
          const text = replyText(stored.events, turn, base)
          if (text !== undefined) {
            if (end.data.reason.kind === 'completed' || end.data.reason.kind === 'max-tokens') return text
            throw new TeamError(
              `debate seat "${name}" produced text then ${describeTurnEnd(end.data.reason)} in turn ${turn}`,
              'TEAM_DEBATE_MEMBER_FAILED',
            )
          }
          if (end.data.reason.kind === 'error') {
            throw new TeamError(
              `debate seat "${name}" failed in turn ${turn}: ${end.data.reason.error.message}`,
              'TEAM_DEBATE_MEMBER_FAILED',
            )
          }
          throw new TeamError(
            `debate seat "${name}" produced no text in turn ${turn} (${describeTurnEnd(end.data.reason)})`,
            'TEAM_DEBATE_EMPTY_TURN',
          )
        }
      }
      if (live === undefined) {
        // A one-shot seat settles without a live Agent. Its journal result is
        // the durable record of that single turn; a lane that lost its Agent
        // has no later turn to read and fails named.
        const mode = current?.mode ?? row.mode ?? 'lane'
        if (mode === 'one-shot' && current !== undefined && current.phase === 'completed') {
          const completedText = (current as TeamMemberSettled).result.output
            ?.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map(block => block.text)
            .join('\n')
            .trim()
          if (completedText !== undefined && completedText.length > 0) return completedText
        }
        throw new TeamError(`debate seat "${name}" produced no output for the latest turn`, 'TEAM_DEBATE_EMPTY_TURN')
      }
      // Lane is live but idle with no new turn yet: allow a grace of
      // consecutive idle polls for message delivery and persistence lag, then
      // fail named so the round records the failure rather than looping forever.
      idleStreak += 1
      if (idleStreak >= IDLE_POLL_LIMIT) {
        throw new TeamError(`debate seat "${name}" produced no output for the latest turn`, 'TEAM_DEBATE_EMPTY_TURN')
      }
      await new Promise<void>(resolve => setTimeout(resolve, 30))
    }
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /**
   * Resolve one live teammate's durable lane policy for scoped tool guards.
   * @param agent - exact live Team member.
   * @returns the durable lane policy, or `shared` outside a teammate lane.
   */
  lanePolicyFor(agent: Agent): LanePolicy {
    return this.roster.lanePolicyFor(agent)
  }

  /**
   * List every durable lane record of one Team, including terminal lanes.
   * @param caller - exact live Team member.
   * @returns lane records ordered by lane name.
   */
  async listLanes(caller: Agent): Promise<LaneRecord[]> {
    return await this.roster.lanesFor(this.roster.membership(caller).root)
  }

  /**
   * Checkpoint one ready lane so its exact patch becomes integrable evidence.
   * Only the Team Lead may checkpoint.
   * @param caller - exact live Team member.
   * @param lane - durable lane name.
   * @param signal - cancellation for the patch copy.
   * @returns the checkpoint hash, path, and byte length.
   */
  async checkpointLane(caller: Agent, lane: string, signal: AbortSignal): Promise<LaneCheckpoint> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can checkpoint lanes', 'TEAM_LEAD_REQUIRED')
    }
    const record = await this.requireLane(membership.root, lane)
    return await this.lanes.checkpoint(record, signal)
  }

  /**
   * Explicitly discard one ready lane after preserving its checkpointed patch.
   * Only the Team Lead may discard.
   * @param caller - exact live Team member.
   * @param lane - durable lane name.
   * @param signal - cancellation for checkpoint and removal.
   * @returns the preserved checkpoint.
   */
  async discardLane(caller: Agent, lane: string, signal: AbortSignal): Promise<LaneCheckpoint> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can discard lanes', 'TEAM_LEAD_REQUIRED')
    }
    const record = await this.requireLane(membership.root, lane)
    return await this.lanes.discard(record, signal)
  }

  /**
   * Apply one reviewed lane patch, run its gates, commit it, and remove the
   * merged checkout. Only the Team Lead may integrate.
   * @param caller - exact live Team member.
   * @param request - lane, expected primary HEAD, reviewed hash, gates, and commit text.
   * @returns the primary commit and gate evidence.
   */
  async integrateLane(
    caller: Agent,
    request: {
      readonly lane: string
      readonly expectedPrimaryHead: string
      readonly patchHash: string
      readonly gateCommands: readonly LaneGateCommand[]
      readonly commitMessage: string
      readonly signal: AbortSignal
    },
  ): Promise<LaneMergeResult> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can integrate lanes', 'TEAM_LEAD_REQUIRED')
    }
    return await this.integration.integrate({ ...request, sessionId: membership.root.id })
  }

  /**
   * Resume a Lead's halted merge queue after investigating the stopped lane.
   * @param caller - exact live Team member.
   */
  resumeLaneQueue(caller: Agent): void {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can resume lane integration', 'TEAM_LEAD_REQUIRED')
    }
    this.integration.resume(membership.root.id)
  }

  /**
   * Report why one Team's merge queue stopped.
   * @param caller - exact live Team member.
   * @returns the halting diagnostic, or undefined while the queue accepts lanes.
   */
  laneQueueHaltReason(caller: Agent): string | undefined {
    const membership = this.roster.membership(caller)
    return this.integration.haltReason(membership.root.id)
  }

  /**
   * Read one repository fleet config without granting spend.
   * @param caller - exact live Team Lead.
   * @param signal - cancellation for path and file reads.
   * @returns the parsed config, exact bytes hash, and approval state.
   */
  async readRepoFleet(caller: Agent, signal: AbortSignal): Promise<RepoFleetSnapshot> {
    return await this.fleet.read(this.leadRepository(caller), signal)
  }

  /**
   * Approve the exact fleet bytes currently in the Lead repository.
   * @param caller - exact live Team Lead.
   * @param signal - cancellation for the read and approval write.
   * @returns the approved snapshot.
   */
  async approveRepoFleet(caller: Agent, signal: AbortSignal): Promise<RepoFleetSnapshot> {
    return await this.fleet.approve(this.leadRepository(caller), signal)
  }

  /**
   * Consume one fleet approval and return the config it covers.
   * @param caller - exact live Team Lead.
   * @param signal - cancellation for the read and approval removal.
   * @returns the admitted configuration snapshot.
   */
  async admitRepoFleet(caller: Agent, signal: AbortSignal): Promise<RepoFleetSnapshot> {
    return await this.fleet.admit(this.leadRepository(caller), signal)
  }

  /**
   * Report honest availability for every configured or registered fleet
   * provider without launching a paid or state-changing probe.
   * @param caller - exact live Team member.
   * @returns one row per provider: `ready` holds a durable lane, `one-shot` runs one delegation to a result.
   */
  fleetAvailability(caller: Agent): FleetProviderAvailability[] {
    this.roster.membership(caller)
    return this.providerAvailability()
  }

  /**
   * Providers a fleet member may name. The roster dispatches a continuable provider
   * as a durable lane and every other registered provider as one delegation that
   * settles with a result, so registration alone admits a provider to a fleet.
   * The Greeneek Harness connection is admitted whenever one of its strategies
   * is registered. `Config.fleetProviders` narrows this set when a deployment pins one.
   * @returns the provider names admitted for fleet use in the current composition.
   */
  private admittedProviders(): ReadonlySet<string> {
    const names = new Set(this.ctx.subagents.list())
    if (this.harnessesRegistry.greeneekConnection() !== undefined) names.add(GREENEEK_HARNESS)
    return names
  }

  /**
   * Providers that hold a durable Team lane, which is what mailbox delivery,
   * interruption, checkpointed write scopes, and startup recovery require.
   * @returns the continuable provider names in the current composition.
   */
  private continuableProviders(): ReadonlySet<string> {
    return new Set(this.ctx.subagents.list().filter(name => (
      this.ctx.subagents.getProvider(name)?.prepareContinuable !== undefined
    )))
  }

  /** Build Harness descriptors from the live provider registry and cached probes. */
  private harnesses(): HarnessDescriptor[] {
    return this.harnessesRegistry.list()
  }

  /**
   * List current Harness descriptors without probing.
   * @returns one descriptor per connection.
   */
  @Remote('harnesses')
  remoteHarnesses(): HarnessDescriptor[] {
    return this.harnesses()
  }

  /**
   * Probe every Harness that supports live discovery and return the refreshed
   * descriptors. A Harness without a probe keeps its registration facts; its
   * `canProbe` flag is false rather than a fabricated catalog.
   * @returns the refreshed descriptors.
   */
  @Remote('refreshHarnesses')
  async remoteRefreshHarnesses(): Promise<HarnessDescriptor[]> {
    return await this.harnessesRegistry.refresh()
  }

  /**
   * Probe one connection, so a user who just installed or authenticated a CLI can
   * re-read only that Harness instead of every other connection.
   * @param connection - the provider registration name the Fleet stores.
   * @returns the full refreshed descriptor list.
   */
  @Remote('refreshHarness')
  async remoteRefreshHarness(connection: string): Promise<HarnessDescriptor[]> {
    const refreshed = await this.harnessesRegistry.refreshOne(connection)
    if (refreshed === undefined) {
      throw new TeamError(`harness connection "${connection}" is not registered or configured`, 'TEAM_HARNESS_UNKNOWN')
    }
    return this.harnesses()
  }

  /**
   * Build provider availability from the live registry and configured names.
   * The Greeneek Harness connection joins the internal strategy rows whenever
   * one of its strategies is registered, so a fleet member may name the
   * connection while existing dispatch keeps its registry names.
   */
  private providerAvailability(): FleetProviderAvailability[] {
    const greeneek = this.harnessesRegistry.greeneekConnection()
    const registered = this.ctx.subagents.list()
    const continuable = this.continuableProviders()
    return fleetProviderAvailability(
      this.config.fleetProviders,
      greeneek === undefined ? registered : [...registered, GREENEEK_HARNESS],
      greeneek?.state === 'ready' ? new Set([...continuable, GREENEEK_HARNESS]) : continuable,
    )
  }

  /**
   * Copy one saved fleet under a fresh identity, ready for editing.
   * @param caller - exact live Team Lead.
   * @param id - fleet being duplicated.
   * @param expectedRevision - fenced settings revision.
   * @returns the section holding the copy, or a typed refusal.
   */
  async duplicateFleet(caller: Agent, id: string, expectedRevision: number): Promise<FleetFavoriteResult> {
    this.requireFleetLead(caller)
    try {
      const current = this.favoritesView().favorites
      const source = current.find(candidate => candidate.id === id)
      if (source === undefined) {
        throw new TeamError(`fleet favorite "${id}" not found`, 'TEAM_FLEET_FAVORITE_NOT_FOUND')
      }
      const copy = duplicateFleetFavorite(source, new Set(current.map(candidate => candidate.id)))
      await this.writeFleetFavorites([...current, copy], expectedRevision)
      return { ok: true, value: this.favoritesView() }
    } catch (error: unknown) {
      return this.fleetFailure(error)
    }
  }

  /**
   * Install one starter fleet as an editable saved fleet, never as fixed
   * configuration the user cannot change or remove.
   * @param caller - exact live Team Lead.
   * @param templateId - `development`, `research`, or `quality-assurance`.
   * @param expectedRevision - fenced settings revision.
   * @returns the section holding the installed fleet, or a typed refusal.
   */
  async installStarterFleet(caller: Agent, templateId: string, expectedRevision: number): Promise<FleetFavoriteResult> {
    this.requireFleetLead(caller)
    try {
      const current = this.favoritesView().favorites
      const installed = starterFleet(templateId, new Set(current.map(candidate => candidate.id)))
      await this.writeFleetFavorites([...current, installed], expectedRevision)
      return { ok: true, value: this.favoritesView() }
    } catch (error: unknown) {
      return this.fleetFailure(error)
    }
  }

  /**
   * Read the fleet favorites section and current settings revision.
   * @param caller - exact live Team Lead.
   * @returns providers, favorites, and the revision for the next fenced write.
   */
  fleetFavorites(caller: Agent): FleetFavoritesView {
    this.roster.membership(caller)
    return this.favoritesView()
  }

  /**
   * Save one favorite by id, replacing a same-id favorite.
   * @param caller - exact live Team Lead.
   * @param favorite - complete favorite value.
   * @param expectedRevision - settings revision the editor read.
   * @returns the committed favorites view or a typed conflict.
   */
  async saveFleetFavorite(
    caller: Agent,
    favorite: FleetFavorite,
    expectedRevision: number,
  ): Promise<FleetFavoriteResult> {
    this.requireFleetLead(caller)
    try {
      validateFleetFavorite(favorite)
      const current = this.favoritesView().favorites
      const next = current.some(candidate => candidate.id === favorite.id)
        ? current.map(candidate => candidate.id === favorite.id ? favorite : candidate)
        : [...current, favorite]
      validateFleetSettings({ favorites: next })
      await this.writeFleetFavorites(next, expectedRevision)
      return { ok: true, value: this.favoritesView() }
    } catch (error: unknown) {
      return this.fleetFailure(error)
    }
  }

  /**
   * Delete one favorite by id.
   * @param caller - exact live Team Lead.
   * @param id - favorite identity.
   * @param expectedRevision - settings revision the editor read.
   * @returns the committed favorites view or a typed conflict.
   */
  async deleteFleetFavorite(
    caller: Agent,
    id: string,
    expectedRevision: number,
  ): Promise<FleetFavoriteResult> {
    this.requireFleetLead(caller)
    try {
      const current = this.favoritesView().favorites
      if (!current.some(candidate => candidate.id === id)) {
        throw new TeamError(`fleet favorite "${id}" not found`, 'TEAM_FLEET_FAVORITE_NOT_FOUND')
      }
      await this.writeFleetFavorites(
        current.filter(candidate => candidate.id !== id),
        expectedRevision,
      )
      return { ok: true, value: this.favoritesView() }
    } catch (error: unknown) {
      return this.fleetFailure(error)
    }
  }

  /**
   * Launch one saved favorite after an explicit confirmation, revalidating
   * every provider at use time and never substituting a different one.
   * @param caller - exact live Team Lead.
   * @param id - favorite identity.
   * @param confirmed - the UI's explicit confirmation; false starts nothing.
   * @returns created members or a typed refusal.
   */
  async launchFleetFavorite(caller: Agent, id: string, confirmed: boolean): Promise<FleetLaunchResult> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can launch a fleet', 'TEAM_LEAD_REQUIRED')
    }
    if (!confirmed) {
      return {
        ok: false,
        error: { code: 'fleet-confirmation-required', message: 'fleet launch was not confirmed' },
      }
    }
    try {
      const favorite = this.favoritesView().favorites.find(candidate => candidate.id === id)
      if (favorite === undefined) {
        throw new TeamError(`fleet favorite "${id}" not found`, 'TEAM_FLEET_FAVORITE_NOT_FOUND')
      }
      if (!isFleetEnabled(favorite)) {
        return {
          ok: false,
          error: { code: 'fleet-disabled', message: `fleet "${id}" is disabled; enable it to launch` },
        }
      }
      const providers = this.fleetAvailability(caller)
      // Validate every provider before the first child exists, so an
      // unavailable later member cannot leave a partially launched fleet.
      for (const member of favorite.members) {
        assertFavoriteProviderReady(member, providers)
        const selection = this.harnessesRegistry.select(member.provider, {
          ...member.model === undefined ? {} : { model: member.model },
          ...member.reasoningEffort === undefined ? {} : { reasoningEffort: member.reasoningEffort },
          ...member.context === undefined ? {} : { context: member.context },
        })
        if (selection.kind === 'refused') {
          return { ok: false, error: { code: selection.code, message: selection.reason } }
        }
      }
      const members: TeamMemberView[] = []
      // Members start in batches of the fleet's concurrency. Every member of a
      // batch reaches its own outcome before the launch reports, so one member's
      // failure cancels no sibling and the already-started siblings stay rostered.
      const concurrency = fleetConcurrency(favorite)
      for (let start = 0; start < favorite.members.length; start += concurrency) {
        const batch = favorite.members.slice(start, start + concurrency)
        const outcomes = await Promise.all(batch.map(async (member): Promise<FleetMemberOutcome> => {
          try {
            const spawned = await this.spawnTeammate(caller, {
              ...favoriteMemberRequest(member),
              signal: this.lifecycle.signal,
            })
            return { ok: true, member: spawned.member }
          } catch (error: unknown) {
            return { ok: false, name: member.name, message: errorMessage(error) }
          }
        }))
        const failures: string[] = []
        for (const outcome of outcomes) {
          if (outcome.ok) {
            members.push(outcome.member)
            continue
          }
          failures.push(`"${outcome.name}": ${outcome.message}`)
        }
        if (failures.length > 0) {
          // Every failed member of the batch is named. Above concurrency 1 several
          // members settle together, and reporting only the last one would hide
          // reasons the Lead has to act on; the list stays bounded by batch size.
          const started = String(members.length)
          const detail = `${String(failures.length)} member(s) failed; ${started} sibling(s) started: ${failures.join('; ')}`
          return { ok: false, error: { code: 'fleet-member-failed', message: detail } }
        }
      }
      return { ok: true, value: { members } }
    } catch (error: unknown) {
      return this.fleetFailure(error)
    }
  }

  /** Require the Lead role that every fleet-favorites mutation needs. */
  private requireFleetLead(caller: Agent): void {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can change fleet favorites', 'TEAM_LEAD_REQUIRED')
    }
  }

  /** Map a favorites/launch failure onto a business result without a wire rejection. */
  private fleetFailure(error: unknown): { ok: false; error: { code: string; message: string } } {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { readonly code?: unknown }).code
      : undefined
    if (code === 'SETTINGS_CONFLICT') {
      return {
        ok: false,
        error: { code: 'fleet-conflict', message: errorMessage(error) },
      }
    }
    if (!(error instanceof TeamError)) throw error
    return {
      ok: false,
      error: { code: error.code, message: error.message },
    }
  }

  /** Require the registered fleet settings owner. */
  private fleetOwner(): { readonly provider: SettingsProvider; readonly scope: SettingsScope<FleetSettings> } {
    const provider = this.settingsProvider
    const scope = this.fleetSettings
    if (provider === undefined || scope === undefined) {
      throw new TeamError('the fleet settings namespace is not mounted', 'TEAM_FLEET_SETTINGS_UNAVAILABLE')
    }
    return { provider, scope }
  }

  /** Persist one complete favorites list under an explicit revision fence. */
  private async writeFleetFavorites(favorites: readonly FleetFavorite[], expectedRevision: number): Promise<void> {
    const { provider } = this.fleetOwner()
    await provider.update(FLEET_SETTINGS_NAMESPACE, { favorites: [...favorites] }, expectedRevision)
  }

  /**
   * Build the current favorites view from the registered settings owner. Stored
   * members naming internal Greeneek strategies read as the Harness connection;
   * the settings bytes keep their legacy values until a user save writes the
   * migrated view back.
   */
  private favoritesView(): FleetFavoritesView {
    const { provider, scope } = this.fleetOwner()
    const descriptor = provider.describe().find(candidate => candidate.ns === FLEET_SETTINGS_NAMESPACE)
    return {
      providers: this.providerAvailability(),
      favorites: migrateFleetSettings(scope.get()).favorites,
      /* v8 ignore next -- a registered fleet owner always appears in its own describe snapshot. */
      revision: descriptor?.revision ?? 0,
    }
  }

  /** Resolve the Lead's repository checkout for one fleet operation. */
  private leadRepository(caller: Agent): string {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can use a repository fleet config', 'TEAM_LEAD_REQUIRED')
    }
    const cwd = membership.root.session.header.cwd
    if (cwd === undefined || cwd.trim().length === 0) {
      throw new TeamError('the Team Lead session has no working directory', 'TEAM_FLEET_CONFIG_MISSING')
    }
    return cwd
  }

  /** Resolve one lane record or fail with a stable not-found code. */
  private async requireLane(root: Agent, lane: string): Promise<LaneRecord> {
    const record = (await this.roster.lanesFor(root)).find(candidate => candidate.lane === lane)
    if (record === undefined) throw new TeamError(`lane "${lane}" not found`, 'TEAM_LANE_NOT_FOUND')
    return record
  }

  /**
   * Read the current roster and non-deleted task board through the generated Remote API.
   * @param agent - exact live Team member used as the authority credential.
   * @returns detached current roster and task views.
   */
  @Remote('view')
  remoteView(agent: Agent): TeamView {
    return {
      members: this.listMembers(agent),
      tasks: this.listTasks(agent),
    }
  }

  /**
   * Create one shared task through the generated Remote API.
   * @param agent - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task or a typed Team rejection.
   */
  @Remote('createTask')
  remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return this.taskMutationResult(this.createTask(agent, request))
  }

  /**
   * Apply one task mutation and preserve Team rejections as business results.
   * @param agent - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed task or a typed Team rejection.
   */
  @Remote('updateTask')
  remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return this.taskMutationResult(this.updateTask(agent, request))
  }

  /**
   * Read provider availability through the generated Remote API.
   * @returns honest provider availability rows.
   */
  @Remote('fleetAvailability')
  remoteFleetAvailability(): FleetProviderAvailability[] {
    return this.providerAvailability()
  }

  /**
   * Launch one favorite through the generated Remote API.
   * @param agent - exact live Team Lead.
   * @param id - favorite identity.
   * @param confirmed - explicit UI confirmation.
   * @returns created members or a typed refusal.
   */
  @Remote('launchFleetFavorite')
  remoteLaunchFleetFavorite(agent: Agent, id: string, confirmed: boolean): Promise<FleetLaunchResult> {
    return this.launchFleetFavorite(agent, id, confirmed)
  }

  /**
   * Read the starter fleet catalog through the generated Remote API, so the Settings
   * page can preview each starter before installing it rather than naming templates
   * the client would have to duplicate.
   * @returns an editable copy of every shipped starter, in shipped order.
   */
  @Remote('fleetStarters')
  remoteFleetStarters(): FleetFavorite[] {
    return fleetStarterTemplates()
  }

  /**
   * Duplicate one saved fleet through the generated Remote API.
   * @param agent - exact live Team Lead.
   * @param id - fleet being duplicated.
   * @param expectedRevision - settings revision the page read.
   * @returns the section holding the copy, or a typed refusal.
   */
  @Remote('duplicateFleet')
  remoteDuplicateFleet(agent: Agent, id: string, expectedRevision: number): Promise<FleetFavoriteResult> {
    return this.duplicateFleet(agent, id, expectedRevision)
  }

  /**
   * Install one starter fleet as an editable favorite through the generated Remote API.
   * @param agent - exact live Team Lead.
   * @param templateId - starter identity from `fleetStarters`.
   * @param expectedRevision - settings revision the page read.
   * @returns the section holding the installed fleet, or a typed refusal.
   */
  @Remote('installStarterFleet')
  remoteInstallStarterFleet(agent: Agent, templateId: string, expectedRevision: number): Promise<FleetFavoriteResult> {
    return this.installStarterFleet(agent, templateId, expectedRevision)
  }

  /** Preserve Team task rejections while allowing unexpected failures to reject the Remote call. */
  private async taskMutationResult(operation: Promise<TeamTaskView>): Promise<TeamTaskMutationResult> {
    try {
      return { ok: true, value: await operation }
    } catch (error) {
      if (!(error instanceof TeamError)) throw error
      return {
        ok: false,
        error: {
          code: error.code === 'TEAM_TASK_STALE_REVISION' ? 'team-task-conflict' : 'team-rejected',
          message: error.message,
        },
      }
    }
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile roster provisioning while lane recovery runs beside it. */
  private async recoverFor(agent: Agent): Promise<void> {
    const membership = this.roster.tryMembership(agent)
    if (membership?.role === 'lead') {
      // Lane recovery owns a separate durable queue; keeping it beside roster
      // recovery preserves the provisioning ordering that publishes children.
      void this.lanes.recover(membership.root.id, this.lifecycle.signal).catch((error: unknown) => {
        this.ctx.logger.warn(`lane recovery for "${membership.root.id}" failed: ${errorMessage(error)}`)
      })
    }
    await this.roster.recoverFor(agent, this.lifecycle.signal)
    await this.mailbox.recoverFor(agent, this.lifecycle.signal)
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.roster.pendingCreations(), failures)
    await this.lifecycle.settle(this.mailbox.pendingDispatches(), failures)
    const rootsWithLanes = this.roster.liveChildrenByRoot()
    for (const agent of this.ctx.agents.list()) {
      if (this.roster.tryMembership(agent)?.role === 'lead' && !rootsWithLanes.has(agent)) {
        rootsWithLanes.set(agent, [])
      }
    }
    for (const [root, childIds] of rootsWithLanes) {
      try {
        if (childIds.length > 0) await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
      try {
        // Disposal is not the caller's cancellation: checkpoint every ready
        // lane after its member stopped, then leave the checkout for resume.
        await this.roster.checkpointLanes(root, new AbortController().signal)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService

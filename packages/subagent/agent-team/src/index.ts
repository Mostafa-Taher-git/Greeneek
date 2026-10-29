/** Agent Teams service façade over roster, mailbox, task, and runtime lifecycle owners. */

import { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type { Agent } from '@greeneek/gnk-agent'
import { resolveGnkHome } from '@greeneek/gnk-home-paths'
import type {} from '@greeneek/gnk-session-persistence'
import type { SettingsProvider, SettingsScope } from '@greeneek/gnk-settings'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { RepoFleetConfigStore } from './fleet-config.ts'
import type { RepoFleetSnapshot } from './fleet-config.ts'
import {
  assertFavoriteProviderReady,
  favoriteMemberRequest,
  FLEET_SETTINGS_NAMESPACE,
  FleetSettingsSchema,
  fleetProviderAvailability,
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
const DEFAULT_FLEET_PROVIDERS: readonly string[] = ['spawn', 'fork']

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
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
    fleetProviders: z.array(z.string()).default([...DEFAULT_FLEET_PROVIDERS]),
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
      fleetProviders: config.fleetProviders ?? [...DEFAULT_FLEET_PROVIDERS],
    }

    if (this.config.fleetProviders.length === 0
      || this.config.fleetProviders.some(provider => provider.trim().length === 0)) {
      throw new TeamError('fleetProviders must name at least one non-empty provider', 'TEAM_INVALID_CONFIG')
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
      allowedProviders: this.config.fleetProviders,
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
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.lanes, this.config.maxMembers)
    this.mailbox = new TeamMailbox(
      ctx,
      this.journal,
      this.roster,
      this.lifecycle,
      this.config.maxPendingMessagesPerMember,
      this.config.maxMessageBytes,
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)

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
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
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
   * @returns one row per provider, with ready only for continuable providers.
   */
  fleetAvailability(caller: Agent): FleetProviderAvailability[] {
    this.roster.membership(caller)
    return this.providerAvailability()
  }

  /** Build provider availability from the live registry and configured names. */
  private providerAvailability(): FleetProviderAvailability[] {
    const providers = this.ctx.subagents.list()
    const continuable = new Set(providers.filter(name => (
      this.ctx.subagents.getProvider(name)?.prepareContinuable !== undefined
    )))
    return fleetProviderAvailability(this.config.fleetProviders, providers, continuable)
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
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can change fleet favorites', 'TEAM_LEAD_REQUIRED')
    }
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
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can change fleet favorites', 'TEAM_LEAD_REQUIRED')
    }
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
      const providers = this.fleetAvailability(caller)
      // Validate every provider before the first child exists, so an
      // unavailable later member cannot leave a partially launched fleet.
      for (const member of favorite.members) assertFavoriteProviderReady(member, providers)
      const members: TeamMemberView[] = []
      for (const member of favorite.members) {
        const spawned = await this.spawnTeammate(caller, {
          ...favoriteMemberRequest(member),
          signal: this.lifecycle.signal,
        })
        members.push(spawned.member)
      }
      return { ok: true, value: { members } }
    } catch (error: unknown) {
      return this.fleetFailure(error)
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

  /** Build the current favorites view from the registered settings owner. */
  private favoritesView(): FleetFavoritesView {
    const { provider, scope } = this.fleetOwner()
    const descriptor = provider.describe().find(candidate => candidate.ns === FLEET_SETTINGS_NAMESPACE)
    return {
      providers: this.providerAvailability(),
      favorites: scope.get().favorites,
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

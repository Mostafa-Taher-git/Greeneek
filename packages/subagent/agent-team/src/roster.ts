/** Team membership, continuable-child provisioning, and roster-owned teardown. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@greeneek/cordis'
import { brandString } from '@greeneek/gnk-brand'
import type { Agent } from '@greeneek/gnk-agent'
import type { MessageId } from '@greeneek/gnk-llm'
import type { SessionId } from '@greeneek/gnk-session'
import type { TokenUsageProjection } from '@greeneek/gnk-token-meter'
import { foldSubagentDescriptor } from '@greeneek/gnk-subagent'
import type { ContinuableStart, SubagentResult, SubagentRun as OneShotRun } from '@greeneek/gnk-subagent'
import { errorMessage, TeamError } from './error.ts'
import type { TeamJournal } from './journal.ts'
import type { LaneLifecycleManager } from './lane-lifecycle.ts'
import type { LaneRecord } from './lane-lifecycle.ts'
import { assertDisjointLaneScopes, resolveLanePolicy } from './lane-policy.ts'
import type { LanePolicy } from './lane-policy.ts'
import type { TeamRuntimeLifecycle } from './lifecycle.ts'
import { readPersistedSession } from './persisted.ts'
import type { TeamState } from './projection.ts'
import { messageAccepted } from './session-message.ts'
import { TeamId } from './types.ts'
import type {
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberMode,
  TeamMemberPhase,
  TeamMemberReport,
  TeamMemberResult,
  TeamMemberSettled,
  TeamMemberSnapshot,
  TeamMemberView,
} from './types.ts'
import { requiredText } from './validation.ts'

const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Keep the durable fields a one-shot run contributes to the roster row. The run's
 * `output` IS the child's final assistant message content, so the row does not
 * duplicate it; the full turn history stays in the child's own Session log.
 */
function memberResultOf(result: SubagentResult): TeamMemberResult {
  return {
    stopReason: result.stopReason,
    ...result.output.length === 0 ? {} : { output: result.output },
    ...result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic },
  }
}

/** Caller identity inside one implicit Team. */
export interface TeamMembership {
  readonly root: Agent
  readonly id: TeamId
  readonly role: 'lead' | 'teammate'
  readonly name: string
}

/**
 * Resolve one active Team member by model-facing name, including the Lead pseudo-row.
 * @param root - exact live Team Lead.
 * @param state - current Team state.
 * @param rawName - candidate member name.
 * @returns resolved durable id and normalized name.
 */
export function resolveActiveMember(
  root: Agent,
  state: TeamState,
  rawName: string,
): { id: SessionId; name: string } {
  const name = rawName.trim()
  if (name === 'lead') return { id: root.id, name }
  const member = state.members.find(candidate => candidate.name === name)
  if (member === undefined || member.phase !== 'active') {
    throw new TeamError(`active teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
  }
  // A one-shot member is a single delegation with one result: it has no inbox and
  // no turn to steer, so interactive operations are refused by name rather than
  // queued somewhere they would never be read.
  if (member.mode === 'one-shot') {
    throw new TeamError(
      `teammate "${name}" runs one-shot and cannot receive messages, follow-ups, or interruption; delegate again or use a continuable provider`,
      'TEAM_MEMBER_NOT_INTERACTIVE',
    )
  }
  return { id: member.id, name }
}

/**
 * Author one settled member's report to the Lead. The mailbox owner supplies this
 * so the roster keeps one durable writer per root while never guessing how a report
 * is framed or dispatched.
 */
export type MemberReportSink = (root: Agent, member: TeamMemberSettled) => Promise<TeamMemberReport>

/** Owns Team identities and the lifecycle of rostered continuable children. */
export class TeamRoster {
  private readonly inFlightCreations = new Set<Promise<unknown>>()
  private readonly budgetControllers = new Map<SessionId, AbortController>()
  private readonly budgetStopped = new Set<SessionId>()

  /**
   * @param ctx - Team service context with Agent, Session, persistence, and subagent services.
   * @param journal - authoritative Lead-log transaction owner.
   * @param lifecycle - shared Team runtime admission cutoff.
   * @param lanes - durable isolated-lane owner.
   * @param maxMembers - maximum immutable roster entries per Team.
   * @param reportSettlement - queue one settled member's report inside the settlement transaction.
   */
  constructor(
    private readonly ctx: Context,
    private readonly journal: TeamJournal,
    private readonly lifecycle: TeamRuntimeLifecycle,
    private readonly lanes: LaneLifecycleManager,
    private readonly maxMembers: number,
    private readonly reportSettlement: MemberReportSink,
  ) {}

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    const membership = this.tryMembership(agent)
    if (membership === undefined) {
      throw new TeamError(`agent "${agent.id}" is not a member of an active Agent Team`, 'TEAM_NOT_MEMBER')
    }
    return membership
  }

  /**
   * Resolve a caller without throwing for scoped installation and lifecycle observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    if (this.ctx.agents.get(agent.id) !== agent) return undefined
    try {
      const parentId = agent.session.header.parentSession
      if (parentId !== undefined) {
        const root = this.ctx.agents.get(parentId)
        if (root !== undefined) {
          const member = this.journal.state(root).members.find(candidate => candidate.id === agent.id)
          if (member?.phase === 'active' || member?.phase === 'provisioning') {
            return { root, id: TeamId(root.id), role: 'teammate', name: member.name }
          }
          // A direct child outside the durable roster is not a teammate. Ordinary
          // host forks are independent roots; subagent descriptors distinguish
          // provider-owned workers that must not receive a nested Team identity.
          if (this.subagentDescriptor(agent)) return undefined
          return { root: agent, id: TeamId(agent.id), role: 'lead', name: 'lead' }
        }
      }
      // A continuation can briefly outlive its parent during child-first teardown.
      // Do not reinterpret that durable child as a new implicit root Team. A host-
      // resumed ordinary fork has no descriptor in its own suffix and remains a
      // valid new root whose inherited Team records stay outside its projected Team state.
      if (this.subagentDescriptor(agent)) return undefined
      return { root: agent, id: TeamId(agent.id), role: 'lead', name: 'lead' }
    } catch {
      // This method is used by lifecycle observers and teardown discovery. A
      // malformed durable stream is surfaced by authoritative Team operations;
      // the non-throwing probe must not veto unrelated Agent lifecycle edges.
      return undefined
    }
  }

  /**
   * Resolve one live teammate's durable lane policy for scoped tool guards.
   * @param agent - exact live teammate.
   * @returns the durable policy; `shared` for the Lead, shared lanes, and non-members.
   */
  lanePolicyFor(agent: Agent): LanePolicy {
    const membership = this.tryMembership(agent)
    if (membership?.role !== 'teammate') return { kind: 'shared' }
    const member = this.journal.state(membership.root).members.find(candidate => candidate.id === agent.id)
    if (member?.readOnly === true) return { kind: 'read-only' }
    if (member?.writeScopes !== undefined && member.writeScopes.length > 0) {
      return { kind: 'isolated', writeScopes: member.writeScopes }
    }
    return { kind: 'shared' }
  }

  /**
   * Report the durable isolated lanes created for one Lead's teammates.
   * @param root - exact live Team Lead.
   * @returns lane records, including terminal ones.
   */
  async lanesFor(root: Agent): Promise<LaneRecord[]> {
    return await this.lanes.list(root.id)
  }

  /**
   * Enforce one teammate's cumulative token ceiling at its next step boundary.
   * The first breach aborts the child through its budget controller and marks
   * the diagnostic on the roster row.
   * @param agent - the agent about to run a step.
   * @returns true when the step must be rejected.
   */
  enforceTokenBudget(agent: Agent): boolean {
    const member = this.teammateSnapshot(agent)
    if (member?.maxTokens === undefined) return false
    const usage = this.ctx.sessionProjections.stateOf(agent.session, 'tokenUsage') as
      | { readonly totals: TokenUsageProjection }
      | undefined
    if (usage === undefined) {
      // The projection was present at admission; losing it at a step boundary
      // cannot prove the ceiling holds, so the step fails closed.
      this.stopForBudget(agent.id)
      return true
    }
    const tokens = usage.totals.uncachedInputTokens
      + usage.totals.outputTokens
      + usage.totals.cacheReadTokens
      + usage.totals.cacheWriteTokens
    if (tokens <= member.maxTokens) return false
    this.stopForBudget(agent.id)
    return true
  }

  /** Abort one child's published run after its token budget was exceeded. */
  private stopForBudget(childId: SessionId): void {
    this.budgetStopped.add(childId)
    this.budgetControllers.get(childId)?.abort('member token budget exceeded')
  }

  /** Resolve one live teammate's durable roster snapshot. */
  private teammateSnapshot(agent: Agent): TeamMemberSnapshot | undefined {
    const membership = this.tryMembership(agent)
    if (membership?.role !== 'teammate') return undefined
    return this.journal.state(membership.root).members.find(candidate => candidate.id === agent.id)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param membership - exact caller membership resolved by this roster.
   * @returns Lead and teammate rows in creation order.
   */
  list(membership: TeamMembership): TeamMemberView[] {
    const { root } = membership
    const state = this.journal.state(root)
    const result: TeamMemberView[] = [{
      id: root.id,
      name: 'lead',
      role: 'lead',
      status: root.status,
      ...root.options.model === undefined ? {} : { model: root.options.model },
      diagnostics: [],
    }]
    for (const member of state.members) {
      const live = this.ctx.agents.get(member.id)
      const model = live?.options.model ?? root.options.model
      const diagnostics = [
        ...member.error === undefined ? [] : [member.error],
        ...this.budgetStopped.has(member.id) ? ['member token budget exceeded'] : [],
      ]
      result.push({
        id: member.id,
        name: member.name,
        role: 'teammate',
        status: member.phase === 'failed'
          ? 'failed'
          : member.phase === 'provisioning'
            ? 'provisioning'
            // A settled one-shot has no live child to report on; it is terminal.
            : member.phase === 'completed'
              ? 'inactive'
              : live?.status ?? 'inactive',
        description: member.description,
        provider: member.provider,
        context: member.context,
        ...model === undefined ? {} : { model },
        diagnostics,
      })
    }
    return result
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawn(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const operation = this.spawnAdmitted(caller, request)
    this.inFlightCreations.add(operation)
    try {
      return await operation
    } finally {
      this.inFlightCreations.delete(operation)
    }
  }

  /**
   * Return admitted creation operations captured for ordered disposal.
   * @returns detached snapshot ordered only by Set insertion.
   */
  pendingCreations(): readonly Promise<unknown>[] {
    return [...this.inFlightCreations]
  }

  /**
   * Reconcile provisioning state when one Team member Session starts.
   * @param agent - newly started exact live Agent.
   * @param signal - shared runtime cancellation.
   */
  async recoverFor(agent: Agent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.tryMembership(agent)
    if (membership?.role === 'lead') await this.reconcileProvisioning(membership.root, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can interrupt teammates', 'TEAM_LEAD_REQUIRED')
    const state = this.journal.state(membership.root)
    const target = resolveActiveMember(membership.root, state, targetName)
    if (target.id === membership.root.id) throw new TeamError('the Team Lead cannot interrupt itself', 'TEAM_INVALID_TARGET')
    const live = this.ctx.agents.get(target.id)
    if (live === undefined) return { previousStatus: 'inactive' }
    const previousStatus = live.status
    this.ctx.subagents.interrupt(target.id, { kind: 'ancestor', agent: caller })
    return { previousStatus }
  }

  /**
   * Group exact live roster children by their current Lead for runtime teardown.
   * @returns each live Lead and the roster child ids currently in the Agent registry.
   */
  liveChildrenByRoot(): Map<Agent, SessionId[]> {
    const teams = new Map<Agent, SessionId[]>()
    for (const agent of this.ctx.agents.list()) {
      const rootId = agent.session.header.parentSession
      if (rootId === undefined) continue
      const root = this.ctx.agents.get(rootId)
      if (root === undefined
        || !this.journal.state(root).members.some(member => member.id === agent.id)) continue
      const children = teams.get(root) ?? []
      children.push(agent.id)
      teams.set(root, children)
    }
    return teams
  }

  /**
   * Release exact teammate Activations through the continuation lifecycle owner.
   * @param root - exact live Team Lead authorizing release.
   * @param childIds - selected roster child ids.
   */
  async stopTeammates(root: Agent, childIds: readonly SessionId[]): Promise<void> {
    try {
      await this.lifecycle.withTimeout(this.ctx.subagents.drainContinuableChildren(root, childIds))
    } finally {
      for (const childId of childIds) {
        this.budgetControllers.delete(childId)
        this.budgetStopped.delete(childId)
      }
    }
  }

  /**
   * Checkpoint every ready lane after its member stopped, preserving the only
   * copy of unmerged work. The checkouts stay in place for resume, merge, or
   * explicit discard.
   * @param root - exact live Team Lead owning the lanes.
   * @param signal - cancellation for the checkpoint copies.
   */
  async checkpointLanes(root: Agent, signal: AbortSignal): Promise<void> {
    for (const record of await this.lanesFor(root)) {
      signal.throwIfAborted()
      if (record.stage !== 'ready') continue
      try {
        await this.lanes.checkpoint(record, signal)
      } catch (error: unknown) {
        // Disposal must keep releasing siblings; the checkout and its unmerged
        // work stay in place, and the warning names the lane to recover.
        this.ctx.logger.warn(`lane "${record.lane}" checkpoint during disposal failed: ${errorMessage(error)}`)
      }
    }
  }

  /** Perform one creation admitted before the Team runtime disposal cutoff. */
  private async spawnAdmitted(
    caller: Agent,
    request: SpawnTeammateRequest,
  ): Promise<SpawnTeammateResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can create teammates', 'TEAM_LEAD_REQUIRED')
    }
    if (request.maxTokens !== undefined
      && (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1)) {
      throw new TeamError('maxTokens must be a positive safe integer', 'TEAM_INVALID_ARGUMENT')
    }
    const root = membership.root
    if (request.maxTokens !== undefined
      && this.ctx.sessionProjections.stateOf(root.session, 'tokenUsage') === undefined) {
      throw new TeamError(
        'teammate token budgets require the tokenUsage session projection',
        'TEAM_BUDGET_METER_UNAVAILABLE',
      )
    }
    const budget = new AbortController()
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal, budget.signal])
    signal.throwIfAborted()
    const name = this.memberName(request.name)
    const description = requiredText(request.description, 'description', 200)
    const policy = resolveLanePolicy({
      ...request.readOnly !== undefined ? { readOnly: request.readOnly } : {},
      ...request.writeScopes !== undefined ? { writeScopes: request.writeScopes } : {},
    })
    if (policy.kind === 'isolated' && request.cwd !== undefined) {
      throw new TeamError('an isolated lane owns its checkout; omit cwd', 'TEAM_INVALID_LANE_POLICY')
    }
    if (policy.kind === 'isolated') {
      // Refuse an overlapping scope before the immutable roster entry exists;
      // lane creation repeats the check under its serialized queue.
      assertDisjointLaneScopes(
        { lane: name, writeScopes: policy.writeScopes },
        await this.lanes.activeScopes(root.id),
      )
    }
    const childId = brandString<SessionId>(randomUUID())
    const provider = requiredText(request.provider, 'provider', 200)
    // The execution model follows the registry: a provider whose descriptor
    // carries prepareContinuable gets a durable lane, and one that does not is
    // dispatched through its supported one-shot start path. Nothing here names a
    // provider, so adding a CLI adapter needs no change to the Team.
    const continuable = this.ctx.subagents.getProvider(provider)?.prepareContinuable !== undefined
    const mode: TeamMemberMode = continuable ? 'lane' : 'one-shot'
    if (continuable && request.timeoutMs !== undefined) {
      throw new TeamError(
        'timeoutMs applies to one-shot members; interrupt a continuable lane instead',
        'TEAM_INVALID_ARGUMENT',
      )
    }
    if (!continuable && policy.kind === 'isolated') {
      throw new TeamError(
        `provider "${provider}" cannot hold an isolated lane: a one-shot member has no durable lane to checkpoint`,
        'TEAM_INVALID_LANE_POLICY',
      )
    }
    const member: TeamMemberSnapshot = {
      id: childId,
      name,
      description,
      provider,
      context: request.context,
      phase: 'provisioning',
      mode,
      ...policy.kind === 'read-only' ? { readOnly: true } : {},
      ...policy.kind === 'isolated' ? { writeScopes: [...policy.writeScopes] } : {},
      ...request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens },
    }

    await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      if (state.members.some(member => member.name === name)) {
        throw new TeamError(`teammate name "${name}" was already used in this Team`, 'TEAM_MEMBER_NAME_TAKEN')
      }
      if (state.members.length >= this.maxMembers) {
        throw new TeamError(`Team member limit ${this.maxMembers} reached`, 'TEAM_MEMBER_LIMIT')
      }
      await this.journal.appendAndFlush(root, 'team/member', { version: 2, teamId: TeamId(root.id), member })
    })

    this.budgetControllers.set(childId, budget)
    let started: ContinuableStart | undefined
    let run: OneShotRun | undefined
    try {
      const laneCwd = policy.kind === 'isolated'
        ? (await this.lanes.create({
          sessionId: root.id,
          lane: name,
          childSessionId: childId,
          cwd: root.session.header.cwd,
          writeScopes: policy.writeScopes,
          signal,
        })).path
        : request.cwd
      // One request object feeds both execution models, so a lane and a one-shot
      // child are composed from the same caller inputs.
      const childRequest = {
        prompt: request.prompt,
        parent: root,
        ...request.agentPreset !== undefined ? { agentPreset: request.agentPreset } : {},
        ...request.agentOptions !== undefined ? { agentOptions: request.agentOptions } : {},
        ...laneCwd !== undefined ? { cwd: laneCwd } : {},
      }
      if (continuable) {
        started = await this.ctx.subagents.startContinuable({
          childId,
          provider: request.provider,
          label: description,
          request: childRequest,
          signal,
        })
        await this.checkpointInitialPrompt(childId, started.messageId, signal)
      } else {
        run = await this.ctx.subagents.start(request.provider, {
          ...childRequest,
          label: description,
          signal,
        })
      }
    } catch (error: unknown) {
      this.budgetControllers.delete(childId)
      const failed: TeamMemberSnapshot = {
        ...member,
        phase: 'failed',
        error: errorMessage(error),
      }
      try {
        const phase = await this.settleProvisioning(root, failed)
        await this.stopTeammates(root, [childId])
        if (phase === 'active') {
          throw new TeamError(
            `teammate "${name}" became active while its creator reported failure`,
            'TEAM_PROVISIONING_CONFLICT',
            { cause: error },
          )
        }
      } catch (recordError: unknown) {
        throw new AggregateError([error, recordError], 'teammate creation and durable failure recording both failed')
      }
      throw error
    }
    const active = {
      ...member,
      phase: 'active' as const,
    } satisfies TeamMemberSnapshot
    // Once the continuation accepted its first prompt, it is a real child. If
    // this checkpoint fails, keep the in-memory active edge instead of inventing
    // an impossible active -> failed transition; restart reconciliation covers
    // the provisioning-only durable prefix.
    const settledPhase = await this.settleProvisioning(root, active)
    if (settledPhase === 'failed') {
      const conflict = new TeamError(
        `teammate "${name}" was reconciled as failed while creation was in progress`,
        'TEAM_PROVISIONING_CONFLICT',
      )
      try {
        await this.stopTeammates(root, [childId])
      } catch (cleanupError: unknown) {
        /* v8 ignore next -- requires the independently tested HMR settlement conflict and cleanup failure together. */
        throw new AggregateError([conflict, cleanupError], 'provisioning conflict cleanup failed')
      }
      throw conflict
    }
    // A one-shot member is live now and settles on its own: its result must not
    // block the Lead's tool call, and a sibling's outcome must never depend on it.
    if (run !== undefined) this.trackOneShot(root, childId, name, run, request.timeoutMs, budget)
    return { member: this.memberView(active) }
  }

  /** Flush the accepted initial inbox item before the Lead can commit `active`. */
  private async checkpointInitialPrompt(
    childId: SessionId,
    messageId: MessageId,
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      signal.throwIfAborted()
      const session = this.ctx.sessions.get(childId)
      if (session === undefined) {
        const stored = await readPersistedSession(this.ctx.sessionPersistence, childId, signal)
        const suffix = stored.events.slice(stored.inheritedEventCount)
        if (messageAccepted(suffix, message => message.id === messageId)) return
        throw new TeamError(
          `teammate "${childId}" initial prompt was not durably accepted`,
          'TEAM_PROVISIONING_CONFLICT',
        )
      }

      const progress = Promise.withResolvers<void>()
      // Abort can win while the durability flush is still pending; mark the
      // later-awaited rejection handled without changing its eventual result.
      void progress.promise.catch(() => undefined)
      const stopEvent = this.ctx.on('session/event', (candidate) => {
        if (candidate === session) progress.resolve()
      })
      const stopDisposed = this.ctx.on('session/disposed', (candidate) => {
        if (candidate === session) progress.resolve()
      })
      const onAbort = (): void => {
        const reason: unknown = signal.reason
        progress.reject(reason instanceof Error
          ? reason
          : new TeamError(`teammate creation aborted: ${errorMessage(reason)}`, 'TEAM_DISPOSED'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        await this.ctx.sessions.flush(session)
        const suffix = session.snapshotEvents(session.inheritedEventCount)
        if (messageAccepted(suffix, message => message.id === messageId)) return
        if (this.ctx.sessions.get(childId) !== session) continue
        await progress.promise
      } finally {
        signal.removeEventListener('abort', onAbort)
        stopDisposed()
        stopEvent()
      }
    }
  }

  /** Settle provisioning-only members from their independently durable child Sessions. */
  private async reconcileProvisioning(root: Agent, signal: AbortSignal): Promise<void> {
    const provisioning = this.journal.state(root).members.filter(member => member.phase === 'provisioning')
    for (const member of provisioning) {
      signal.throwIfAborted()
      // A live child means creation is still completing in this process. Its
      // creator owns the terminal member edge.
      if (this.ctx.agents.get(member.id) !== undefined) continue
      let phase: 'active' | 'failed' = 'failed'
      // Re-activation requires a persisted continuable descriptor, which only a
      // lane child ever writes: an unfinished one-shot member settles failed here
      // with the same reason the Lead sees, never as a resumable lane.
      let failure = 'persisted child Session does not match the provisioned continuation'
      try {
        const loaded = await readPersistedSession(this.ctx.sessionPersistence, member.id, signal)
        const suffix = loaded.events.slice(loaded.inheritedEventCount)
        const descriptor = foldSubagentDescriptor(suffix)
        const acceptedInitialPrompt = messageAccepted(suffix, message => message.source.kind === 'user')
        if (loaded.header.parentSession === root.id
          && descriptor?.mode === 'continuable'
          && descriptor.provider === member.provider
          && acceptedInitialPrompt) phase = 'active'
      } catch (error: unknown) {
        failure = `child Session recovery failed: ${errorMessage(error)}`
      }
      signal.throwIfAborted()
      await this.journal.transact(root.id, async () => {
        signal.throwIfAborted()
        const current = this.journal.state(root).members.find(candidate => candidate.id === member.id)
        if (current?.phase !== 'provisioning') return
        const settled: TeamMemberSnapshot = {
          ...current,
          phase,
          ...phase === 'failed' ? { error: failure } : {},
        }
        await this.journal.appendAndFlush(root, 'team/member', {
          version: 2,
          teamId: TeamId(root.id),
          member: settled,
        })
      })
    }
  }

  /**
   * Watch a dispatched one-shot member and record its one terminal edge.
   *
   * The Lead's spawn call returns as soon as the run is published: a member that
   * never settles cannot hold the Team's tool call open, and one member's outcome
   * never decides a sibling's. `budget` still owns cancellation, so a budget or
   * lifecycle abort reaches the provider through the signal the run was started with.
   * @param root - exact live Team Lead owning the durable roster.
   * @param childId - reserved member identity, which is the one-shot run's id.
   * @param name - model-facing member name, used in the recorded reason.
   * @param run - the published one-shot run.
   * @param timeoutMs - cancellation budget, or undefined for none.
   */
  private trackOneShot(
    root: Agent,
    childId: SessionId,
    name: string,
    run: OneShotRun,
    timeoutMs: number | undefined,
    budget: AbortController,
  ): void {
    const operation = (async (): Promise<void> => {
      const outcome = await this.awaitOneShot(run, timeoutMs, name, budget)
      try {
        await this.settleOneShotCompleted(root, childId, outcome)
      } catch (error: unknown) {
        // The report and the terminal edge commit separately, so a failure here can
        // leave either side durable; the warning names the member whose settlement did
        // not finish rather than claiming a specific edge is missing.
        this.ctx.logger.warn(`teammate "${name}" settlement did not complete: ${errorMessage(error)}`)
      }
    })()
    this.inFlightCreations.add(operation)
    // The operation reports its own settlement failure above, so it never rejects
    // and disposal only needs the removal to stop tracking a settled member.
    void operation.finally(() => { this.inFlightCreations.delete(operation) })
  }

  /**
   * Await one published run, cancelling it at its budget.
   *
   * A budget expiry is a terminal outcome, not a hanging member. It aborts the
   * member's own budget controller, which the composed start signal carries to
   * the provider — so the run is cancelled at its source and not merely locally
   * abandoned — and the run is disposed exactly once, here, on every path. The
   * timer is the only wall clock involved, so a test drives it with fake timers
   * instead of racing real time.
   * @param run - the published one-shot run.
   * @param timeoutMs - cancellation budget, or undefined to wait for settlement.
   * @param name - member name for the recorded reason.
   * @param budget - the member's own cancellation controller.
   * @returns the result to persist plus an optional failure reason.
   */
  private async awaitOneShot(
    run: OneShotRun,
    timeoutMs: number | undefined,
    name: string,
    budget: AbortController,
  ): Promise<{ readonly result: TeamMemberResult; readonly error?: string }> {
    if (timeoutMs === undefined) {
      try {
        return { result: memberResultOf(await run.result) }
      } catch (error: unknown) {
        return { result: { stopReason: 'error' }, error: errorMessage(error) }
      } finally {
        await run.dispose()
      }
    }
    const expired = Promise.withResolvers<void>()
    const timer = setTimeout(() => {
      budget.abort(`one-shot member "${name}" exceeded its ${String(timeoutMs)}ms budget`)
      expired.resolve()
    }, timeoutMs)
    try {
      const settled = await Promise.race([
        run.result.then(result => ({ result })),
        expired.promise.then(() => undefined),
      ])
      if (settled !== undefined) return { result: memberResultOf(settled.result) }
      // Never await the run after expiry: a provider that ignores cancellation
      // must not be able to keep this member — or the Team's disposal — waiting.
      void run.result.catch(() => undefined)
      return {
        result: { stopReason: 'timeout' },
        error: `one-shot member "${name}" exceeded its ${String(timeoutMs)}ms budget and was cancelled`,
      }
    } catch (error: unknown) {
      return { result: { stopReason: 'error' }, error: errorMessage(error) }
    } finally {
      clearTimeout(timer)
      await run.dispose()
    }
  }

  /**
   * Append the single `active -> completed` edge a one-shot member may take and queue
   * its report to the Lead.
   *
   * The report is queued first, inside the same root transaction as the terminal edge.
   * Each append commits on its own, so this order means a process interruption between
   * the two writes can only leave the report queued for the mailbox's own recovery, never
   * a terminal member whose Lead is left waiting for a result. Delivery starts only
   * after the transaction commits, because it steers the Lead and opens its own
   * transaction on the same root.
   * @param root - exact live Team Lead owning the durable roster.
   * @param childId - settled member identity.
   * @param outcome - the result to persist plus an optional failure reason.
   */
  private async settleOneShotCompleted(
    root: Agent,
    childId: SessionId,
    outcome: { readonly result: TeamMemberResult; readonly error?: string },
  ): Promise<void> {
    try {
      const dispatch = await this.journal.transact(root.id, async () => {
        const current = this.journal.state(root).members.find(member => member.id === childId)
        /* v8 ignore next -- restart reconciliation can settle the row before this watcher arrives. */
        if (current?.phase !== 'active') return () => Promise.resolve(false)
        const settled: TeamMemberSettled = {
          ...current,
          phase: 'completed',
          result: outcome.result,
          ...outcome.error === undefined ? {} : { error: outcome.error },
        }
        const report = await this.reportSettlement(root, settled)
        await this.journal.appendAndFlush(root, 'team/member', {
          version: 2,
          teamId: TeamId(root.id),
          member: settled,
        })
        return report.dispatch
      })
      await dispatch()
    } finally {
      // Terminal is terminal: the member's cancellation controller and budget
      // diagnostic stop being consulted whether the edge landed or not.
      this.budgetControllers.delete(childId)
      this.budgetStopped.delete(childId)
    }
  }

  /** Build one runtime member row after successful creation. */
  private memberView(member: TeamMemberSnapshot & { readonly phase: 'active' }): TeamMemberView {
    const live = this.ctx.agents.get(member.id)
    return {
      id: member.id,
      name: member.name,
      role: 'teammate',
      status: live?.status ?? 'inactive',
      description: member.description,
      provider: member.provider,
      context: member.context,
      ...live?.options.model === undefined ? {} : { model: live.options.model },
      diagnostics: [],
    }
  }

  /** Validate a never-reused model-facing teammate name. */
  private memberName(value: string): string {
    if (!MEMBER_NAME.test(value) || value.length > 64 || value === 'lead') {
      throw new TeamError(
        'teammate name must be lower-kebab-case, at most 64 characters, and not "lead"',
        'TEAM_INVALID_MEMBER_NAME',
      )
    }
    return value
  }

  /** Append one terminal provisioning edge unless recovery already settled it. */
  private async settleProvisioning(
    root: Agent,
    terminal: TeamMemberSnapshot,
  ): Promise<TeamMemberPhase> {
    return this.journal.transact(root.id, async () => {
      const current = this.journal.state(root).members.find(member => member.id === terminal.id)
      /* v8 ignore next 3 -- the append-only provisioning event is committed by this operation before settlement. */
      if (current === undefined) {
        throw new TeamError(`provisioned teammate "${terminal.id}" disappeared`, 'TEAM_PROVISIONING_CONFLICT')
      }
      if (current.phase !== 'provisioning') return current.phase
      await this.journal.appendAndFlush(root, 'team/member', {
        version: 2,
        teamId: TeamId(root.id),
        member: terminal,
      })
      return terminal.phase === 'active' ? 'active' : 'failed'
    })
  }

  /** Whether a Session's own suffix identifies a provider-owned subagent child. */
  private subagentDescriptor(agent: Agent): boolean {
    return foldSubagentDescriptor(agent.session.snapshotEvents(agent.session.inheritedEventCount)) !== undefined
  }
}

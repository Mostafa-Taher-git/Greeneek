import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import AgentLoop from '@greeneek/gnk-agent-loop'
import { mountAgentLoopTestDependencies } from '@greeneek/gnk-agent-loop-testkit'
import { createUserMessage } from '@greeneek/gnk-llm'
import type { SubagentResult } from '@greeneek/gnk-subagent'
import { SessionLogOffset, SessionId, type Session, type SessionEvent } from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import FileSettingsProvider from '@greeneek/gnk-settings-file'
import SubagentService from '@greeneek/gnk-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@greeneek/gnk-subagent/internal'
import * as SubagentFork from '@greeneek/gnk-subagent-fork-in-process'
import * as SubagentSpawn from '@greeneek/gnk-subagent-spawn-in-process'
import TokenMeter from '@greeneek/gnk-token-meter'
import { defineContentToolFixture } from '@greeneek/gnk-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { LaneLifecycleManager, TeamError, TeamId, TeamMessageId, TeamTaskId } from '../src/index.ts'
import { TeamRuntimeLifecycle } from '../src/lifecycle.ts'
import { teamProjectionDefinition } from '../src/projection.ts'
import type { TeamMemberSnapshot, TeamMessageSnapshot, TeamTaskSnapshot } from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Detached durable Team read through the same projection definition as the service. */
function durable(agent: Agent): {
  members: TeamMemberSnapshot[]
  tasks: TeamTaskSnapshot[]
  pendingMessages: TeamMessageSnapshot[]
} {
  let projected = teamProjectionDefinition.init(agent.session.header)
  for (const event of agent.session.snapshotEvents()) projected = teamProjectionDefinition.apply(projected, event)
  if (projected.failure !== undefined) throw new Error(projected.failure)
  const state = projected
  return {
    members: state.members,
    tasks: state.tasks,
    pendingMessages: state.messages.filter(message => !state.delivered.includes(message.id)),
  }
}

/** Read one stored session's full event log through a short-lived read handle. */
async function storedEvents(ctx: Context, id: SessionId): Promise<readonly SessionEvent[]> {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    return await handle.read()
  } finally {
    await handle.close()
  }
}

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  config: ConstructorParameters<typeof TeamService>[1] = {},
  leadMeta: { cwd?: string } = {},
  mountTokenMeter = false,
  settingsPath?: string,
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'gnk-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  if (mountTokenMeter) await ctx.plugin(TokenMeter)
  if (settingsPath !== undefined) await ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false })
  const teamFiber = await ctx.plugin(TeamService, config)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' }, leadMeta)
  return { ctx, lead, adapter, storageRoot, teamFiber }
}

function content(text: string) {
  return [{ type: 'text' as const, text }]
}

interface TeamServiceInternals {
  readonly roster: {
    readonly inFlightCreations: Set<Promise<unknown>>
    checkpointInitialPrompt(childId: SessionId, messageId: string, signal: AbortSignal): Promise<void>
    reconcileProvisioning(root: Agent, signal: AbortSignal): Promise<void>
    liveChildrenByRoot(): Map<Agent, SessionId[]>
    enforceTokenBudget(agent: Agent): boolean
    checkpointLanes(root: Agent, signal: AbortSignal): Promise<void>
  }
  readonly mailbox: {
    tryDispatch(root: Agent, message: TeamMessageSnapshot, signal: AbortSignal): Promise<boolean>
    serializeDispatch(message: TeamMessageSnapshot, operation: () => Promise<boolean>): Promise<boolean>
    markDelivered(root: Agent, messageId: ReturnType<typeof TeamMessageId>, targetId: SessionId): Promise<void>
  }
  readonly journal: {
    state(root: Agent): unknown
    appendAndFlush(root: Agent, type: string, data: unknown): Promise<void>
  }
  disposeRuntime(): Promise<void>
  recoverFor(agent: Agent): Promise<void>
  scheduleRecovery(agent: Agent): void
}

/** White-box access follows the runtime owners so coverage does not widen the service API. */
function teamInternals(ctx: Context): TeamServiceInternals {
  return ctx.agentTeams as unknown as TeamServiceInternals
}

function spawn(
  ctx: Context,
  lead: Agent,
  name: string,
  options: { context?: 'fresh' | 'fork'; provider?: string } = {},
) {
  const context = options.context ?? 'fresh'
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: content(`${name} initial`),
    context,
    provider: options.provider ?? (context === 'fork' ? 'fork' : 'spawn'),
    signal: SIGNAL,
  })
}

async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const agent = ctx.agents.get(id)
    expect(agent?.status).toBe('running')
    return agent!
  }, { timeout: 5_000 })
}

describe('Team identity and provisioning', () => {
  it('rejects missing and failed authoritative Team projections', async () => {
    const first = await setup([])
    const journal = teamInternals(first.ctx).journal
    const stateOf = first.ctx.sessionProjections.stateOf.bind(first.ctx.sessionProjections)
    const stateOfSpy = vi.spyOn(first.ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => (
      key === 'agentTeam' ? undefined : stateOf(session, key)
    ))
    expect(() => journal.state(first.lead)).toThrow('Agent Teams projection is not registered')
    stateOfSpy.mockImplementation((session, key) => key === 'agentTeam'
      ? { ...teamProjectionDefinition.init(session.header), failure: 'failed Team projection' }
      : stateOf(session, key))
    expect(() => journal.state(first.lead)).toThrow('failed Team projection')
    stateOfSpy.mockRestore()
  })

  it('rejects deployment limits that are not positive safe integers', async () => {
    const fields = [
      'maxMembers',
      'maxTasks',
      'maxPendingMessagesPerMember',
      'maxMessageBytes',
      'disposalTimeoutMs',
    ] as const
    for (const field of fields) {
      for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(setup([], { [field]: value })).rejects.toThrow()
      }
    }
    // `[]` is the documented sentinel meaning "admit what this composition
    // registers", so it must build; only a blank name is a misconfiguration.
    await expect(setup([], { fleetProviders: [] })).resolves.toBeDefined()
    await expect(setup([], { fleetProviders: ['spawn', ' '] })).rejects.toThrow('fleetProviders')
  })

  it('supports direct-constructor defaults and recovers roots that already exist', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    const storageRoot = mkdtempSync(join(tmpdir(), 'gnk-team-direct-'))
    roots.push(storageRoot)
    await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    const lead = await ctx.agentLoop.create(SessionId('preexisting-lead'), {})
    const service = new TeamService(ctx)

    expect(service.listMembers(lead)).toEqual([expect.objectContaining({
      name: 'lead',
      status: 'idle',
      diagnostics: [],
    })])
    const provisioning = {
      id: SessionId('preexisting-child'),
      name: 'preexisting-worker',
      description: 'preexisting responsibility',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    lead.session.append('team/member', {
      version: 2,
      teamId: TeamId(lead.id),
      member: provisioning,
    })
    expect(service.listMembers(lead)[1]).toEqual(expect.objectContaining({
      name: 'preexisting-worker',
      status: 'provisioning',
      diagnostics: [],
    }))
    expect(service.listMembers(lead)[1]).not.toHaveProperty('model')
    await Promise.resolve()
  })

  it('creates fresh and fork teammates with immutable names and bounded roster size', async () => {
    const { ctx, lead } = await setup([
      textResponse('lead answer'),
      textResponse('fork answer'),
      textResponse('fresh answer'),
    ], { maxMembers: 2 })
    lead.followup(createUserMessage({ content: content('lead turn'), source: { kind: 'user' } }))
    await lead.whenIdle()

    const forked = await spawn(ctx, lead, 'fork-worker', { context: 'fork' })
    await waitNoAgent(ctx, forked.member.id)
    const fresh = await spawn(ctx, lead, 'fresh-worker')
    await waitNoAgent(ctx, fresh.member.id)

    expect((await ctx.sessionPersistence.stat(forked.member.id))?.header.isSeeded).toBe(true)
    expect((await ctx.sessionPersistence.stat(fresh.member.id))?.header.isSeeded).toBe(false)
    expect(ctx.agentTeams.listMembers(lead).map(row => [row.name, row.context, row.status])).toEqual([
      ['lead', undefined, 'idle'],
      ['fork-worker', 'fork', 'inactive'],
      ['fresh-worker', 'fresh', 'inactive'],
    ])
    await expect(spawn(ctx, lead, 'third-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
    await expect(spawn(ctx, lead, 'fresh-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })
  })

  it('flushes the accepted child prompt before committing the active roster edge', async () => {
    const { ctx, lead } = await setup([textResponse('checkpointed child answer')])
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const order: string[] = []
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (session.id === lead.id && durable(lead).members[0]?.phase === 'active') {
        order.push('lead-active')
      } else if (session.id !== lead.id) {
        order.push('child')
      }
      return flush(session)
    })

    const started = await spawn(ctx, lead, 'checkpoint-worker')
    expect(order.indexOf('child')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('child')).toBeLessThan(order.indexOf('lead-active'))
    await waitNoAgent(ctx, started.member.id)
  })

  it('checkpoints live and detached inbox receipts and aborts an unresolved checkpoint', async () => {
    const { ctx, lead } = await setup([])
    const internal = teamInternals(ctx).roster
    let liveSession: Session | undefined
    const liveFiber = await ctx.plugin(Object.assign(function checkpointFixture(childCtx: Context) {
      liveSession = childCtx.sessions.create(SessionId('checkpoint-child'))
    }, { inject: ['sessions'] }))
    if (liveSession === undefined) throw new Error('checkpoint fixture did not create its Session')
    const initial = createUserMessage({ content: content('checkpoint me'), source: { kind: 'user' } })
    const checkpoint = internal.checkpointInitialPrompt(liveSession.id, initial.id, SIGNAL)
    await Promise.resolve()
    lead.inject(createUserMessage({ content: content('unrelated progress'), source: { kind: 'user' } }))
    const unrelatedFiber = await ctx.plugin(Object.assign(function unrelatedCheckpointFixture(childCtx: Context) {
      childCtx.sessions.create(SessionId('unrelated-checkpoint-child'))
    }, { inject: ['sessions'] }))
    await unrelatedFiber.dispose()
    liveSession.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [initial],
    })
    await checkpoint
    // Live sessions persist only through an attached agent-loop writer; this
    // bare fixture session seeds its durable log directly for the cold reread.
    const persisted = await ctx.sessionPersistence.create(liveSession.header)
    await persisted.append(liveSession.snapshotEvents())
    await persisted.close()
    await liveFiber.dispose()

    await expect(internal.checkpointInitialPrompt(liveSession.id, initial.id, SIGNAL)).resolves.toBeUndefined()
    const missing = createUserMessage({ content: content('missing'), source: { kind: 'user' } })
    await expect(internal.checkpointInitialPrompt(liveSession.id, missing.id, SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })

    let disposedSession: Session | undefined
    const disposedFiber = await ctx.plugin(Object.assign(function disposedCheckpointFixture(childCtx: Context) {
      disposedSession = childCtx.sessions.create(SessionId('disposed-checkpoint-child'))
    }, { inject: ['sessions'] }))
    if (disposedSession === undefined) throw new Error('disposed checkpoint fixture did not create its Session')
    const disposed = internal.checkpointInitialPrompt(disposedSession.id, missing.id, SIGNAL)
    const disposedResult = expect(disposed).rejects.toThrow('not found')
    await Promise.resolve()
    await disposedFiber.dispose()
    await disposedResult

    let abortedSession: Session | undefined
    const abortedFiber = await ctx.plugin(Object.assign(function abortedCheckpointFixture(childCtx: Context) {
      abortedSession = childCtx.sessions.create(SessionId('aborted-checkpoint-child'))
    }, { inject: ['sessions'] }))
    if (abortedSession === undefined) throw new Error('aborted checkpoint fixture did not create its Session')
    const controller = new AbortController()
    const aborted = internal.checkpointInitialPrompt(abortedSession.id, missing.id, controller.signal)
    await Promise.resolve()
    controller.abort({ kind: 'test' })
    await expect(aborted).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })

    const errorController = new AbortController()
    const errorAborted = internal.checkpointInitialPrompt(abortedSession.id, missing.id, errorController.signal)
    const errorResult = expect(errorAborted).rejects.toThrow('checkpoint stopped')
    await Promise.resolve()
    errorController.abort(new Error('checkpoint stopped'))
    await errorResult
    await abortedFiber.dispose()
  })

  it('drains an accepted child when its initial durability checkpoint fails', async () => {
    const { ctx, lead } = await setup(['hang'])
    vi.spyOn(teamInternals(ctx).roster, 'checkpointInitialPrompt')
      .mockRejectedValueOnce(new Error('checkpoint failed'))

    await expect(spawn(ctx, lead, 'checkpoint-failure')).rejects.toThrow('checkpoint failed')
    const member = durable(lead).members[0]
    expect(member).toMatchObject({ phase: 'failed', error: 'checkpoint failed' })
    if (member !== undefined) await waitNoAgent(ctx, member.id)
  })

  it('records failed provisioning durably, reserves its name, and counts it against the limit', async () => {
    const { ctx, lead } = await setup([], { maxMembers: 1 })
    await expect(spawn(ctx, lead, 'failed-worker', { provider: 'missing' })).rejects.toThrow()

    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({
      name: 'failed-worker',
      status: 'failed',
      provider: 'missing',
    })
    await expect(spawn(ctx, lead, 'failed-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })
    await expect(spawn(ctx, lead, 'other-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
  })

  it('records non-Error provider failures and contains a reversed provisioning settlement race', async () => {
    const first = await setup([])
    vi.spyOn(first.ctx.subagents, 'startContinuable').mockRejectedValueOnce('string provider failure')
    await expect(spawn(first.ctx, first.lead, 'string-failure')).rejects.toBe('string provider failure')
    expect(first.ctx.agentTeams.listMembers(first.lead)[1]).toMatchObject({
      status: 'failed',
      diagnostics: ['string provider failure'],
    })
    await expect(first.ctx.agentTeams.sendMessage(first.lead, {
      target: 'string-failure', content: content('cannot deliver'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })

    const second = await setup([])
    vi.spyOn(second.ctx.subagents, 'startContinuable').mockImplementationOnce(async () => {
      const provisioning = durable(second.lead).members[0]
      if (provisioning === undefined) throw new Error('missing provisioning edge')
      second.lead.session.append('team/member', {
        version: 2,
        teamId: TeamId(second.lead.id),
        member: { ...provisioning, phase: 'active' },
      })
      await second.ctx.sessions.flush(second.lead.session)
      throw new Error('creator failed after recovery settled active')
    })
    await expect(spawn(second.ctx, second.lead, 'reverse-race')).rejects.toBeInstanceOf(AggregateError)
    expect(durable(second.lead).members[0]?.phase).toBe('active')
  })

  it('cleans up a child when recovery settles its provisioning record first', async () => {
    const { ctx, lead } = await setup(['hang'])
    const start = ctx.subagents.startContinuable.bind(ctx.subagents)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let childId: SessionId | undefined
    vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(async (spec) => {
      childId = spec.childId
      entered.resolve(undefined)
      await release.promise
      return start(spec)
    })

    const spawning = spawn(ctx, lead, 'racing-worker')
    const rejected = expect(spawning).rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })
    await entered.promise
    await teamInternals(ctx).roster.reconcileProvisioning(lead, SIGNAL)
    expect(durable(lead).members[0]?.phase).toBe('failed')

    release.resolve(undefined)
    await rejected
    if (childId === undefined) throw new Error('reserved child id was not observed')
    await waitNoAgent(ctx, childId)
  })

  it('handles a continuation that settles before the active roster view or conflict cleanup lookup', async () => {
    const first = await setup([])
    vi.spyOn(teamInternals(first.ctx).roster, 'checkpointInitialPrompt').mockResolvedValueOnce()
    vi.spyOn(first.ctx.subagents, 'startContinuable').mockImplementationOnce(async spec => ({
      childId: spec.childId!,
      messageId: createUserMessage({ content: content('accepted'), source: { kind: 'user' } }).id,
    }))
    const inactive = await spawn(first.ctx, first.lead, 'instant-worker')
    expect(inactive.member).toMatchObject({ status: 'inactive', diagnostics: [] })
    expect(inactive.member).not.toHaveProperty('model')

    const second = await setup([])
    vi.spyOn(teamInternals(second.ctx).roster, 'checkpointInitialPrompt').mockResolvedValueOnce()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(second.ctx.subagents, 'startContinuable').mockImplementationOnce(async (spec) => {
      entered.resolve(undefined)
      await release.promise
      return {
        childId: spec.childId!,
        messageId: createUserMessage({ content: content('accepted'), source: { kind: 'user' } }).id,
      }
    })
    const spawning = spawn(second.ctx, second.lead, 'instant-conflict')
    const rejected = expect(spawning).rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })
    await entered.promise
    await teamInternals(second.ctx).roster.reconcileProvisioning(second.lead, SIGNAL)
    release.resolve(undefined)
    await rejected
  })

  it('validates names and permits only the Lead to create or interrupt teammates', async () => {
    const { ctx, lead } = await setup(['hang'])
    for (const name of ['Lead', 'lead', '-bad', 'bad-', 'bad_name', 'x'.repeat(65)]) {
      await expect(spawn(ctx, lead, name)).rejects.toMatchObject({ code: 'TEAM_INVALID_MEMBER_NAME' })
    }
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)
    await expect(spawn(ctx, worker, 'nested')).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    expect(() => ctx.agentTeams.interrupt(worker, 'worker')).toThrow(expect.objectContaining({ code: 'TEAM_LEAD_REQUIRED' }))
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'running' })
    await waitNoAgent(ctx, worker.id)
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'inactive' })
    expect(() => ctx.agentTeams.interrupt(lead, 'lead')).toThrow(expect.objectContaining({ code: 'TEAM_INVALID_TARGET' }))
  })

  it('validates teammate text fields and pre-provisioning cancellation', async () => {
    const { ctx, lead } = await setup([])
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'empty-description',
      description: ' ',
      prompt: content('unused'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'empty-provider',
      description: 'valid description',
      prompt: content('unused'),
      context: 'fresh',
      provider: ' ',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const controller = new AbortController()
    controller.abort(new TeamError('cancelled before provisioning', 'TEST_CANCELLED'))
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'cancelled-worker',
      description: 'never provisioned',
      prompt: content('unused'),
      context: 'fresh',
      provider: 'spawn',
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'TEST_CANCELLED' })
    expect(durable(lead).members).toEqual([])
  })

  it('treats an ordinary fork as a new Root Team and filters inherited Team state', async () => {
    const { ctx, lead } = await setup([])
    await ctx.agentTeams.createTask(lead, { subject: 'parent task', description: 'belongs to parent' })
    const handle = await ctx.agents.create({
      sessionId: SessionId('ordinary-fork'),
      seed: lead.session.snapshotEvents(),
      meta: { parentSession: lead.id, isSeeded: true },
      inheritedEventCount: SessionLogOffset(lead.session.seq),
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    expect(ctx.agentTeams.membership(handle.agent)).toMatchObject({
      id: TeamId(handle.agent.id),
      role: 'lead',
      name: 'lead',
    })
    expect(durable(handle.agent)).toMatchObject({ members: [], tasks: [], pendingMessages: [] })
    await handle.dispose()
  })

  it('rejects stale Agent identities and non-Team subagent children', async () => {
    const { ctx, lead } = await setup([textResponse('done')])
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary worker',
      request: { prompt: content('ordinary'), parent: lead },
      signal: SIGNAL,
    })
    const live = ctx.agents.get(started.childId)
    if (live !== undefined) expect(ctx.agentTeams.tryMembership(live)).toBeUndefined()
    await waitNoAgent(ctx, started.childId)
    expect(() => ctx.agentTeams.membership(lead)).not.toThrow()

    const impostor = { ...lead } as Agent
    expect(ctx.agentTeams.tryMembership(impostor)).toBeUndefined()
    expect(() => ctx.agentTeams.membership(impostor)).toThrow(expect.objectContaining({ code: 'TEAM_NOT_MEMBER' }))

    const orphanRoot = await ctx.agents.create({
      sessionId: SessionId('orphan-ordinary-root'),
      meta: { parentSession: SessionId('absent-parent') },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(ctx.agentTeams.membership(orphanRoot.agent)).toMatchObject({ role: 'lead', name: 'lead' })
    await orphanRoot.dispose()
  })

  it('does not reinterpret an orphaned provider child or malformed parent stream as a Team root', async () => {
    const first = await setup([textResponse('ordinary child done')])
    const parent = await first.ctx.agents.create({
      sessionId: SessionId('temporary-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const started = await first.ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: content('finish'), parent: parent.agent },
      signal: SIGNAL,
    })
    await waitNoAgent(first.ctx, started.childId)
    await parent.dispose()
    const orphan = await first.ctx.agents.resume({
      resumeSessionId: started.childId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(first.ctx.agentTeams.tryMembership(orphan.agent)).toBeUndefined()
    expect(teamInternals(first.ctx).roster.liveChildrenByRoot()).toEqual(new Map())
    await orphan.dispose()

    const second = await setup([])
    const child = await second.ctx.agents.create({
      sessionId: SessionId('malformed-parent-child'),
      meta: { parentSession: second.lead.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const journal = teamInternals(second.ctx).journal
    const state = journal.state.bind(journal)
    journal.state = () => { throw new Error('malformed Team stream') }
    expect(second.ctx.agentTeams.tryMembership(child.agent)).toBeUndefined()
    journal.state = state
    await child.dispose()
  })
})

describe('Team shared task DAG', () => {
  it('fails loudly when the durable numeric task id space is exhausted', async () => {
    const { ctx, lead } = await setup([])
    const id = TeamTaskId(`task-${Number.MAX_SAFE_INTEGER}`)
    lead.session.append('team/task', {
      version: 2,
      teamId: TeamId(lead.id),
      task: {
        id,
        revision: 1,
        subject: 'last numeric task',
        description: 'occupies the final safe numeric task id',
        status: 'pending',
        blockedBy: [],
        writeScopes: [],
      },
    })
    await ctx.sessions.flush(lead.session)

    await expect(ctx.agentTeams.createTask(lead, {
      subject: 'cannot allocate',
      description: 'no safe numeric task id remains',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_LIMIT' })
  })

  it('bounds non-deleted tasks while retaining deleted task ids as tombstones', async () => {
    const { ctx, lead } = await setup([], { maxTasks: 1 })
    const first = await ctx.agentTeams.createTask(lead, { subject: 'first', description: 'first task' })
    await expect(ctx.agentTeams.createTask(lead, { subject: 'overflow', description: 'overflow task' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_LIMIT' })

    const deleted = await ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'delete',
    })
    const second = await ctx.agentTeams.createTask(lead, { subject: 'second', description: 'second task' })
    expect(deleted.status).toBe('deleted')
    expect(second.id).toBe(TeamTaskId('task-2'))
    expect(ctx.agentTeams.getTask(lead, first.id).status).toBe('deleted')
    expect(ctx.agentTeams.listTasks(lead).map(task => task.id)).toEqual([second.id])
  })

  it('enforces CAS, ownership, dependencies, transitions, and write-scope warnings', async () => {
    const { ctx, lead } = await setup(['hang', 'hang', textResponse('beta integrated update')])
    const firstMember = await spawn(ctx, lead, 'alpha')
    const alpha = await waitRunning(ctx, firstMember.member.id)
    const secondMember = await spawn(ctx, lead, 'beta')
    const beta = await waitRunning(ctx, secondMember.member.id)

    const first = await ctx.agentTeams.createTask(alpha, {
      subject: 'first',
      description: 'first task',
      writeScopes: ['src', './src/', 'src'],
    })
    const second = await ctx.agentTeams.createTask(beta, {
      subject: 'second',
      description: 'second task',
      blockedBy: [first.id],
      writeScopes: ['src/feature'],
    })
    expect(first.writeScopes).toEqual(['src'])
    await expect(ctx.agentTeams.updateTask(beta, {
      taskId: second.id,
      expectedRevision: second.revision,
      action: 'claim',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })

    const claimed = await ctx.agentTeams.updateTask(alpha, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'claim',
    })
    await expect(ctx.agentTeams.updateTask(beta, {
      taskId: first.id,
      expectedRevision: claimed.revision,
      action: 'claim',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_ALREADY_CLAIMED' })
    expect(ctx.agentTeams.getTask(beta, second.id)).toMatchObject({
      ready: false,
      writeScopeWarnings: [`write scopes overlap with ${first.id}`],
    })
    await expect(ctx.agentTeams.updateTask(beta, {
      taskId: first.id,
      expectedRevision: claimed.revision,
      action: 'edit',
      subject: 'stolen',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_UNAUTHORIZED' })
    await expect(ctx.agentTeams.updateTask(alpha, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'complete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })

    const completed = await ctx.agentTeams.updateTask(alpha, {
      taskId: first.id,
      expectedRevision: claimed.revision,
      action: 'complete',
    })
    expect(completed.status).toBe('completed')
    expect(ctx.agentTeams.getTask(beta, second.id).ready).toBe(true)
    const secondClaim = await ctx.agentTeams.updateTask(beta, {
      taskId: second.id,
      expectedRevision: second.revision,
      action: 'claim',
    })
    const released = await ctx.agentTeams.updateTask(beta, {
      taskId: second.id,
      expectedRevision: secondClaim.revision,
      action: 'release',
    })
    expect(released).toMatchObject({ status: 'pending', ready: true })
    expect('ownerId' in released).toBe(false)

    ctx.agentTeams.interrupt(lead, 'alpha')
    ctx.agentTeams.interrupt(lead, 'beta')
    await Promise.all([waitNoAgent(ctx, alpha.id), waitNoAgent(ctx, beta.id)])
  })

  it('rejects malformed scopes and every invalid dependency relation', async () => {
    const { ctx, lead } = await setup([])
    const first = await ctx.agentTeams.createTask(lead, { subject: 'one', description: 'one' })
    const second = await ctx.agentTeams.createTask(lead, {
      subject: 'two', description: 'two', blockedBy: [first.id],
    })
    await expect(ctx.agentTeams.createTask(lead, {
      subject: 'bad', description: 'bad', blockedBy: [TeamTaskId('missing')],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'set_dependencies',
      blockedBy: [second.id],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_DEPENDENCY_CYCLE' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'set_dependencies',
      blockedBy: [first.id],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_DEPENDENCY_CYCLE' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'set_dependencies',
      blockedBy: [second.id, second.id],
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    for (const scope of ['', '.', '..', '/root', 'C:\\root', 'C:root', 'a//b', 'a/../b']) {
      await expect(ctx.agentTeams.createTask(lead, {
        subject: 'scope', description: 'scope', writeScopes: [scope],
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_WRITE_SCOPE' })
    }
  })

  it('rejects incomplete mutations, invalid transitions, and deletion of a live blocker', async () => {
    const { ctx, lead } = await setup([])
    await expect(ctx.agentTeams.createTask(lead, { subject: ' ', description: 'invalid' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.createTask(lead, { subject: 'invalid', description: '' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.createTask(lead, { subject: 'x'.repeat(201), description: 'too long' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const blocker = await ctx.agentTeams.createTask(lead, { subject: 'blocker', description: 'blocker' })
    await ctx.agentTeams.createTask(lead, {
      subject: 'dependent', description: 'dependent', blockedBy: [blocker.id],
    })
    expect(() => ctx.agentTeams.getTask(lead, TeamTaskId('missing')))
      .toThrow(expect.objectContaining({ code: 'TEAM_TASK_NOT_FOUND' }))
    for (const action of ['release', 'complete', 'reopen'] as const) {
      await expect(ctx.agentTeams.updateTask(lead, {
        taskId: blocker.id,
        expectedRevision: blocker.revision,
        action,
      })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    }
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id,
      expectedRevision: blocker.revision,
      action: 'edit',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id,
      expectedRevision: blocker.revision,
      action: 'set_dependencies',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id,
      expectedRevision: blocker.revision,
      action: 'delete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_HAS_DEPENDENTS' })
  })

  it('supports Lead reassignment, completion, reopen, and deletion permissions', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'owner')
    const owner = await waitRunning(ctx, started.member.id)
    const task = await ctx.agentTeams.createTask(owner, { subject: 'lifecycle', description: 'lifecycle' })
    const assigned = await ctx.agentTeams.updateTask(lead, {
      taskId: task.id,
      expectedRevision: task.revision,
      action: 'reassign',
      owner: 'owner',
    })
    await expect(ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: assigned.revision,
      action: 'reassign',
      owner: 'lead',
    })).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    const complete = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: assigned.revision,
      action: 'complete',
    })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: task.id,
      expectedRevision: complete.revision,
      action: 'reassign',
      owner: 'lead',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    const reopened = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: complete.revision,
      action: 'reopen',
    })
    const claimed = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: reopened.revision,
      action: 'claim',
    })
    const deleted = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: claimed.revision,
      action: 'delete',
    })
    expect(deleted.status).toBe('deleted')
    expect(ctx.agentTeams.listTasks(lead)).toEqual([])
    await expect(ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: deleted.revision,
      action: 'edit',
      subject: 'late',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_DELETED' })
    ctx.agentTeams.interrupt(lead, 'owner')
    await waitNoAgent(ctx, owner.id)
  })

  it('covers partial edits, Lead ownership, unassignment, and blocked reassignment', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'editor')
    const editor = await waitRunning(ctx, started.member.id)
    const blocker = await ctx.agentTeams.createTask(lead, { subject: 'blocker', description: 'blocker' })
    const task = await ctx.agentTeams.createTask(lead, {
      subject: 'draft',
      description: 'draft description',
      blockedBy: [blocker.id],
    })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: TeamTaskId('missing-update'), expectedRevision: 1, action: 'delete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: 'editor',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })

    const leadClaim = await ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id, expectedRevision: blocker.revision, action: 'claim',
    })
    expect(leadClaim.ownerName).toBe('lead')
    const completedBlocker = await ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id, expectedRevision: leadClaim.revision, action: 'complete',
    })
    expect(completedBlocker.status).toBe('completed')
    const assigned = await ctx.agentTeams.updateTask(lead, {
      taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: 'editor',
    })
    const subject = await ctx.agentTeams.updateTask(editor, {
      taskId: task.id, expectedRevision: assigned.revision, action: 'edit', subject: 'edited subject',
    })
    const description = await ctx.agentTeams.updateTask(editor, {
      taskId: task.id,
      expectedRevision: subject.revision,
      action: 'edit',
      description: 'edited description',
    })
    const scopes = await ctx.agentTeams.updateTask(editor, {
      taskId: task.id,
      expectedRevision: description.revision,
      action: 'edit',
      writeScopes: ['src/nested'],
    })
    expect(scopes).toMatchObject({
      subject: 'edited subject',
      description: 'edited description',
      writeScopes: ['src/nested'],
    })
    const unassigned = await ctx.agentTeams.updateTask(lead, {
      taskId: task.id, expectedRevision: scopes.revision, action: 'reassign', owner: ' ',
    })
    expect(unassigned).toMatchObject({ status: 'pending' })
    expect('ownerId' in unassigned).toBe(false)

    const broad = await ctx.agentTeams.createTask(lead, {
      subject: 'broad scope', description: 'broad scope', writeScopes: ['src'],
    })
    const narrow = await ctx.agentTeams.createTask(lead, {
      subject: 'narrow scope', description: 'narrow scope', writeScopes: ['src/nested'],
    })
    const disjoint = await ctx.agentTeams.createTask(lead, {
      subject: 'disjoint scope', description: 'disjoint scope', writeScopes: ['docs'],
    })
    await ctx.agentTeams.updateTask(lead, {
      taskId: broad.id, expectedRevision: broad.revision, action: 'claim',
    })
    await ctx.agentTeams.updateTask(lead, {
      taskId: narrow.id, expectedRevision: narrow.revision, action: 'claim',
    })
    await ctx.agentTeams.updateTask(lead, {
      taskId: disjoint.id, expectedRevision: disjoint.revision, action: 'claim',
    })
    expect(ctx.agentTeams.getTask(lead, broad.id).writeScopeWarnings)
      .toEqual([`write scopes overlap with ${narrow.id}`])

    ctx.agentTeams.interrupt(lead, 'editor')
    await waitNoAgent(ctx, editor.id)
  })
})

describe('Team Remote API', () => {
  it('exports Team views and task mutations from the owning service', async () => {
    const { ctx, lead } = await setup([])
    expect(ctx.agentTeams.typertRemote).toMatchObject({ serviceKey: 'agentTeams', namespace: 'agentTeams' })
    expect(ctx.agentTeams.remoteView(lead)).toEqual({
      members: [expect.objectContaining({ name: 'lead', role: 'lead', status: 'idle' })],
      tasks: [],
    })

    const createdResult = await ctx.agentTeams.remoteCreateTask(lead, {
      subject: 'Remote task',
      description: 'Created through the generated API',
      blockedBy: [],
      writeScopes: ['packages/subagent/agent-team'],
    })
    expect(createdResult).toMatchObject({ ok: true, value: { revision: 1 } })
    if (!createdResult.ok) throw new Error('Remote task creation did not succeed')
    const created = createdResult.value
    await expect(ctx.agentTeams.remoteUpdateTask(lead, {
      taskId: created.id,
      expectedRevision: created.revision,
      action: 'claim',
    })).resolves.toMatchObject({
      ok: true,
      value: { id: created.id, revision: 2, ownerName: 'lead' },
    })
    expect(ctx.agentTeams.remoteView(lead).tasks).toHaveLength(1)
  })

  it('preserves Team task rejections and propagates unexpected failures', async () => {
    const { ctx, lead } = await setup([])
    const createRequest = {
      subject: 'Remote task', description: 'Rejected task', blockedBy: [], writeScopes: [],
    }
    const request = { taskId: TeamTaskId('task-1'), expectedRevision: 1, action: 'delete' as const }
    vi.spyOn(ctx.agentTeams, 'createTask')
      .mockRejectedValueOnce(new TeamError('invalid task', 'TEAM_TASK_INVALID'))
      .mockRejectedValueOnce(new Error('unexpected creation failure'))
    vi.spyOn(ctx.agentTeams, 'updateTask')
      .mockRejectedValueOnce(new TeamError('stale', 'TEAM_TASK_STALE_REVISION'))
      .mockRejectedValueOnce(new TeamError('denied', 'TEAM_TASK_FORBIDDEN'))
      .mockRejectedValueOnce(new Error('unexpected mutation failure'))

    await expect(ctx.agentTeams.remoteCreateTask(lead, createRequest)).resolves.toEqual({
      ok: false,
      error: { code: 'team-rejected', message: 'invalid task' },
    })
    await expect(ctx.agentTeams.remoteCreateTask(lead, createRequest))
      .rejects.toThrow('unexpected creation failure')
    await expect(ctx.agentTeams.remoteUpdateTask(lead, request)).resolves.toEqual({
      ok: false,
      error: { code: 'team-task-conflict', message: 'stale' },
    })
    await expect(ctx.agentTeams.remoteUpdateTask(lead, request)).resolves.toEqual({
      ok: false,
      error: { code: 'team-rejected', message: 'denied' },
    })
    await expect(ctx.agentTeams.remoteUpdateTask(lead, request)).rejects.toThrow('unexpected mutation failure')
  })
})

describe('Team mailbox and waiting', () => {
  it('steers a message addressed to the Lead and checkpoints its receipt', async () => {
    const { ctx, lead } = await setup(['hang'])
    const message: TeamMessageSnapshot = {
      id: TeamMessageId('steer-lead-message'),
      senderId: SessionId('team-worker'),
      senderName: 'worker',
      targetId: lead.id,
      content: content('progress report'),
    }
    lead.session.append('team/message/queued', {
      version: 2,
      teamId: TeamId(lead.id),
      message,
    })

    await expect(teamInternals(ctx).mailbox.tryDispatch(lead, message, SIGNAL)).resolves.toBe(true)
    expect(lead.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(input => input.source.kind === 'team-message'
        && input.source.messageId === message.id))).toBe(true)
    expect(durable(lead).pendingMessages).toEqual([])
    lead.cancel({ kind: 'parent' })
    await lead.whenIdle()
  })

  it('acknowledges steered messages persisted by a busy Lead before model claim', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang', 'hang'], { maxPendingMessagesPerMember: 1 })
    const started = await spawn(ctx, lead, 'lead-reporter')
    const reporter = await waitRunning(ctx, started.member.id)
    lead.followup(createUserMessage({ content: content('keep the Lead busy'), source: { kind: 'user' } }))
    await waitRunning(ctx, lead.id)

    const first = await ctx.agentTeams.sendMessage(reporter, {
      target: 'lead', content: content('first progress report'), signal: SIGNAL,
    })
    const second = await ctx.agentTeams.sendMessage(reporter, {
      target: 'lead', content: content('second progress report'), signal: SIGNAL,
    })
    expect([first.status, second.status]).toEqual(['accepted', 'accepted'])
    expect(lead.status).toBe('running')
    expect(durable(lead).pendingMessages).toEqual([])

    const messageIds = new Set([first.messageId, second.messageId])
    const persisted = await storedEvents(ctx, lead.id)
    const receiptOrder = persisted.flatMap((event) => {
      if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
        message.source.kind === 'team-message' && messageIds.has(message.source.messageId))) {
        return ['agent/inbox/spliced']
      }
      if (event.type === 'team/message/delivered' && messageIds.has(event.data.messageId)) {
        return ['team/message/delivered']
      }
      return []
    })
    expect(receiptOrder).toEqual([
      'agent/inbox/spliced',
      'team/message/delivered',
      'agent/inbox/spliced',
      'team/message/delivered',
    ])

    const receiptCount = lead.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'team-message'
        && messageIds.has(message.source.messageId))).length
    await teamFiber.dispose()
    await ctx.plugin(TeamService, { maxPendingMessagesPerMember: 1 })
    await vi.waitFor(() => { expect(durable(lead).pendingMessages).toEqual([]) })
    expect(lead.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'team-message'
        && messageIds.has(message.source.messageId)))).toHaveLength(receiptCount)

    lead.cancel({ kind: 'parent' })
    await lead.whenIdle()
  })

  it('flushes a live pending receipt before acknowledgement without inserting a duplicate', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'pending-target')
    const target = await waitRunning(ctx, started.member.id)
    const immediate = await ctx.agentTeams.sendMessage(lead, {
      target: 'pending-target',
      content: content('live steer receipt'),
      signal: SIGNAL,
    })
    expect(immediate.status).toBe('accepted')
    expect(durable(lead).pendingMessages).toEqual([])
    expect(target.inbox.nextStep.some(item => item.source.kind === 'team-message'
      && item.source.messageId === immediate.messageId)).toBe(true)

    const message: TeamMessageSnapshot = {
      id: TeamMessageId('live-pending-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: target.id,
      content: content('durable pending receipt'),
    }
    lead.session.append('team/message/queued', {
      version: 2,
      teamId: TeamId(lead.id),
      message,
    })
    await ctx.sessions.flush(lead.session)
    target.inject(createUserMessage({
      content: content('durable pending receipt'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: message.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    }))

    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const flushed: SessionId[] = []
    const flushSpy = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      flushed.push(session.id)
      return flush(session)
    })
    const delivered = await teamInternals(ctx).mailbox.tryDispatch(lead, message, SIGNAL)

    expect(delivered).toBe(true)
    expect(flushed.slice(0, 2)).toEqual([target.id, lead.id])
    expect(target.inbox.nextStep.filter(item => item.source.kind === 'team-message'
      && item.source.messageId === message.id)).toHaveLength(1)
    expect(durable(lead).pendingMessages).toEqual([])

    const disappearing: TeamMessageSnapshot = {
      ...message,
      id: TeamMessageId('disappearing-pending-message'),
      content: content('canceled before checkpoint'),
    }
    lead.session.append('team/message/queued', {
      version: 2,
      teamId: TeamId(lead.id),
      message: disappearing,
    })
    await flush(lead.session)
    const disappearingInput = createUserMessage({
      content: content('canceled before checkpoint'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: disappearing.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    })
    target.inject(disappearingInput)
    flushSpy.mockImplementationOnce(async (session) => {
      target.inbox.remove(disappearingInput.id)
      return flush(session)
    })
    await expect(teamInternals(ctx).mailbox.tryDispatch(lead, disappearing, SIGNAL)).resolves.toBe(false)
    expect(durable(lead).pendingMessages.map(pending => pending.id)).toEqual([disappearing.id])

    ctx.agentTeams.interrupt(lead, 'pending-target')
    target.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, target.id)
  })

  it('acknowledges steered messages accepted by a busy target inbox', async () => {
    const { ctx, lead } = await setup(['hang'], { maxPendingMessagesPerMember: 1 })
    const started = await spawn(ctx, lead, 'busy-target')
    const target = await waitRunning(ctx, started.member.id)
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const flushed: SessionId[] = []
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      flushed.push(session.id)
      return flush(session)
    })

    const first = await ctx.agentTeams.sendMessage(lead, {
      target: 'busy-target', content: content('first steered message'), signal: SIGNAL,
    })

    expect(first.status).toBe('accepted')
    expect(flushed).toEqual([lead.id, target.id, lead.id])
    expect(durable(lead).pendingMessages).toEqual([])
    expect(target.inbox.nextStep.some(message => message.source.kind === 'team-message'
      && message.source.messageId === first.messageId)).toBe(true)

    flushed.length = 0
    const second = await ctx.agentTeams.sendMessage(lead, {
      target: 'busy-target', content: content('second steered message'), signal: SIGNAL,
    })

    expect(second.status).toBe('accepted')
    expect(flushed).toEqual([lead.id, target.id, lead.id])
    expect(durable(lead).pendingMessages).toEqual([])
    expect(target.inbox.nextStep.filter(message => message.source.kind === 'team-message'
      && (message.source.messageId === first.messageId || message.source.messageId === second.messageId)))
      .toHaveLength(2)

    ctx.agentTeams.interrupt(lead, 'busy-target')
    target.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, target.id)
  })

  it('serializes concurrent Steer delivery admission for one target', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'ordered-target')
    const target = await waitRunning(ctx, started.member.id)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const admitted: string[] = []
    vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)
      .mockImplementation(async (_parent, _childId, blocks, source) => {
        const last = blocks.at(-1)
        const text = last?.type === 'text' ? last.text : ''
        admitted.push(text)
        if (text === 'first steer') {
          entered.resolve(undefined)
          await release.promise
        }
        const input = createUserMessage({ content: blocks, source })
        target.inject(input)
        return input.id
      })

    const first = ctx.agentTeams.sendMessage(lead, {
      target: 'ordered-target', content: content('first steer'), signal: SIGNAL,
    })
    await entered.promise
    let secondSettled = false
    const second = ctx.agentTeams.sendMessage(lead, {
      target: 'ordered-target', content: content('second steer'), signal: SIGNAL,
    }).finally(() => { secondSettled = true })
    await vi.waitFor(() => { expect(durable(lead).pendingMessages).toHaveLength(2) })
    expect(admitted).toEqual(['first steer'])
    expect(secondSettled).toBe(false)

    release.resolve(undefined)
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'accepted' },
      { status: 'accepted' },
    ])
    expect(admitted).toEqual(['first steer', 'second steer'])

    ctx.agentTeams.interrupt(lead, 'ordered-target')
    target.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, target.id)
  })

  it('delivers persisted mail before the later message that cold-resumes its target', async () => {
    const { ctx, lead } = await setup([textResponse('target initial'), 'hang', 'hang'])
    const started = await spawn(ctx, lead, 'reordered-target')
    await waitNoAgent(ctx, started.member.id)
    const earlier: TeamMessageSnapshot = {
      id: TeamMessageId('earlier-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: started.member.id,
      content: content('earlier steer'),
    }
    lead.session.append('team/message/queued', {
      version: 2,
      teamId: TeamId(lead.id),
      message: earlier,
    })
    await ctx.sessions.flush(lead.session)

    const later = await ctx.agentTeams.sendMessage(lead, {
      target: 'reordered-target', content: content('later steer'), signal: SIGNAL,
    })
    expect(later.status).toBe('accepted')
    const target = await waitRunning(ctx, started.member.id)
    await vi.waitFor(() => {
      const accepted = target.session.snapshotEvents().flatMap(event => event.type === 'agent/inbox/spliced'
        ? event.data.inserted.flatMap(message => message.source.kind === 'team-message'
          ? [message.source.messageId]
          : [])
        : [])
      expect(accepted).toEqual([earlier.id, later.messageId])
    })

    ctx.agentTeams.interrupt(lead, 'reordered-target')
    target.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, target.id)
  })

  it('deduplicates live target history and contains inspection and delivery failures', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('inactive target initial')])
    const liveStarted = await spawn(ctx, lead, 'live-target')
    const live = await waitRunning(ctx, liveStarted.member.id)
    const internal = teamInternals(ctx).mailbox
    const message: TeamMessageSnapshot = {
      id: TeamMessageId('live-recorded-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: live.id,
      content: content('already in live history'),
    }
    lead.session.append('team/message/queued', {
      version: 2, teamId: TeamId(lead.id), message,
    })
    await ctx.sessions.flush(lead.session)
    live.session.append('user/message', createUserMessage({
      content: content('different Team message first'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: TeamMessageId('other-message'),
        senderId: lead.id,
        senderName: 'lead',
      },
    }), { surfaceOp: 'append' })
    live.session.append('user/message', createUserMessage({
      content: content('already in live history'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: message.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    }), { surfaceOp: 'append' })
    await expect(internal.tryDispatch(lead, message, SIGNAL)).resolves.toBe(true)
    await internal.markDelivered(lead, message.id, live.id)
    await expect(internal.tryDispatch(lead, message, SIGNAL)).resolves.toBe(true)

    const wrongTarget: TeamMessageSnapshot = {
      ...message,
      id: TeamMessageId('wrong-target-message'),
    }
    lead.session.append('team/message/queued', {
      version: 2, teamId: TeamId(lead.id), message: wrongTarget,
    })
    await ctx.sessions.flush(lead.session)
    await internal.markDelivered(lead, wrongTarget.id, SessionId('wrong-target'))
    await expect(internal.serializeDispatch(wrongTarget, async () => true)).resolves.toBe(true)
    const serialEntered = Promise.withResolvers<undefined>()
    const releaseSerial = Promise.withResolvers<undefined>()
    const serialFirst = internal.serializeDispatch(wrongTarget, async () => {
      serialEntered.resolve(undefined)
      await releaseSerial.promise
      return true
    })
    await serialEntered.promise
    const serialSecond = internal.serializeDispatch({
      ...wrongTarget, id: TeamMessageId('second-serialized-message'),
    }, async () => true)
    releaseSerial.resolve(undefined)
    await expect(Promise.all([serialFirst, serialSecond])).resolves.toEqual([true, true])

    const warnings: string[] = []
    ctx.logger.warn = ((value: unknown) => { warnings.push(String(value)) }) as typeof ctx.logger.warn
    const failedAck = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('acknowledgement flush failed'))
    live.session.append('user/message', createUserMessage({
      content: content('acknowledgement failure'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: wrongTarget.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    }), { surfaceOp: 'append' })
    await vi.waitFor(() => {
      expect(warnings.some(warning => warning.includes('acknowledgement flush failed'))).toBe(true)
    })
    failedAck.mockRestore()

    const inactiveStarted = await spawn(ctx, lead, 'inactive-target')
    await waitNoAgent(ctx, inactiveStarted.member.id)
    const openRead = vi.spyOn(ctx.sessionPersistence, 'open').mockRejectedValueOnce(new Error('read unavailable'))
    const uncertain = await ctx.agentTeams.sendMessage(lead, {
      target: 'inactive-target', content: content('inspection failure'), signal: SIGNAL,
    })
    expect(uncertain.status).toBe('queued')
    openRead.mockRestore()

    vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)
      .mockRejectedValueOnce(new Error('delivery unavailable'))
    const failed = await ctx.agentTeams.sendMessage(lead, {
      target: 'inactive-target', content: content('delivery failure'), signal: SIGNAL,
    })
    expect(failed.status).toBe('queued')
    expect(warnings.some(warning => warning.includes('read unavailable'))).toBe(true)
    expect(warnings.some(warning => warning.includes('delivery unavailable'))).toBe(true)

    ctx.agentTeams.interrupt(lead, 'live-target')
    await waitNoAgent(ctx, live.id)
  })

  it('cold-resumes an inactive sibling with sender attribution', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const alphaStarted = await spawn(ctx, lead, 'alpha')
    const alpha = await waitRunning(ctx, alphaStarted.member.id)
    const betaStarted = await spawn(ctx, lead, 'beta')
    const beta = await waitRunning(ctx, betaStarted.member.id)
    ctx.agentTeams.interrupt(lead, 'beta')
    await waitNoAgent(ctx, beta.id)

    const first = await ctx.agentTeams.sendMessage(alpha, {
      target: 'beta', content: content('first update'), signal: SIGNAL,
    })
    expect(first.status).toBe('accepted')
    await waitNoAgent(ctx, betaStarted.member.id)
    await vi.waitFor(() => { expect(durable(lead).pendingMessages).toEqual([]) })

    const stored = await storedEvents(ctx, betaStarted.member.id)
    const peerMessages = stored.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'team-message')
    expect(peerMessages.map((event) => {
      if (event.type !== 'user/message') return undefined
      const block = event.data.content.at(-1)
      return block?.type === 'text' ? block.text : undefined
    })).toEqual(['first update'])
    expect(peerMessages.map(event => event.type === 'user/message'
      ? event.data.content[0]?.type === 'text' && event.data.content[0].text
      : undefined)).toEqual([
      expect.stringMatching(/^Team message .* from alpha:$/u),
    ])
    expect(peerMessages.map(event => event.type === 'user/message' && event.data.source.kind === 'team-message'
      ? [event.data.source.messageId, event.data.source.senderName]
      : undefined)).toEqual([
      [first.messageId, 'alpha'],
    ])

    ctx.agentTeams.interrupt(lead, 'alpha')
    await waitNoAgent(ctx, alpha.id)
  })

  it('enforces message byte and pending-count limits without encouraging retry after enqueue', async () => {
    const { ctx, lead } = await setup([textResponse('idle')], {
      maxMessageBytes: 256,
      maxPendingMessagesPerMember: 1,
    })
    const target = await spawn(ctx, lead, 'target')
    await waitNoAgent(ctx, target.member.id)
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('x'.repeat(300)), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MESSAGE_TOO_LARGE' })
    vi.spyOn(ctx.sessionPersistence, 'open').mockRejectedValueOnce(new Error('temporary read failure'))
    const queued = await ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('one'), signal: SIGNAL,
    })
    expect(queued.status).toBe('queued')
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('two'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MAILBOX_FULL' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'lead', content: content('self'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_SELF_MESSAGE' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'missing', content: content('unknown target'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
    const controller = new AbortController()
    controller.abort(new TeamError('cancelled before queue', 'TEST_CANCELLED'))
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('cancelled'), signal: controller.signal,
    })).rejects.toMatchObject({ code: 'TEST_CANCELLED' })
  })

  it('interrupts only the current turn and retains an already accepted follow-up', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('after interrupt')])
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)
    const followup = await ctx.agentTeams.sendMessage(lead, {
      target: 'worker', content: content('retained follow-up'), signal: SIGNAL,
    })
    expect(followup.status).toBe('accepted')
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'running' })
    await vi.waitFor(() => { expect(worker.status).toBe('idle') })
    expect(worker.inbox.nextStep.some(message => message.source.kind === 'team-message'
      && message.source.messageId === followup.messageId)).toBe(true)
    worker.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, worker.id)
  })

  it('waits for one change, supports cancellation, times out, and releases waiters on HMR disposal', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    const storageRoot = mkdtempSync(join(tmpdir(), 'gnk-team-wait-'))
    roots.push(storageRoot)
    await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    const fiber = await ctx.plugin(TeamService)
    const service = ctx.agentTeams
    const lead = await ctx.agentLoop.create(SessionId('wait-lead'), {})

    await expect(service.waitForChange(lead, 9_999, SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TIMEOUT' })
    const alreadyAborted = new AbortController()
    alreadyAborted.abort(new TeamError('cancelled before wait', 'TEST_CANCELLED'))
    await expect(service.waitForChange(lead, 10_000, alreadyAborted.signal))
      .rejects.toMatchObject({ code: 'TEST_CANCELLED' })

    const changed = service.waitForChange(lead, 10_000, SIGNAL)
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const flushEntered = Promise.withResolvers<undefined>()
    const releaseFlush = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
      flushEntered.resolve(undefined)
      await releaseFlush.promise
      return await flush(session)
    })
    let waitSettled = false
    void changed.finally(() => { waitSettled = true })
    const creating = service.createTask(lead, { subject: 'wake', description: 'wake waiter' })
    await flushEntered.promise
    expect(waitSettled).toBe(false)
    releaseFlush.resolve(undefined)
    await creating
    await expect(changed).resolves.toEqual({ timedOut: false })

    const controller = new AbortController()
    const cancelled = service.waitForChange(lead, 10_000, controller.signal)
    controller.abort(new TeamError('cancelled', 'TEST_CANCELLED'))
    await expect(cancelled).rejects.toMatchObject({ code: 'TEST_CANCELLED' })

    const stringAbort = new AbortController()
    const firstWaiter = service.waitForChange(lead, 10_000, stringAbort.signal)
    const secondWaiter = service.waitForChange(lead, 10_000, SIGNAL)
    stringAbort.abort('string cancellation')
    await expect(firstWaiter).rejects.toMatchObject({
      code: 'TEAM_WAIT_ABORTED',
      message: 'wait_agent aborted: string cancellation',
    })
    await service.createTask(lead, { subject: 'second waiter', description: 'second waiter remains registered' })
    await expect(secondWaiter).resolves.toEqual({ timedOut: false })

    const objectAbort = new AbortController()
    const objectCancelled = service.waitForChange(lead, 10_000, objectAbort.signal)
    objectAbort.abort({ kind: 'user' })
    await expect(objectCancelled).rejects.toMatchObject({
      code: 'TEAM_WAIT_ABORTED',
      message: "wait_agent aborted: { kind: 'user' }",
    })

    await service.createTask(lead, { subject: 'already changed', description: 'edge-triggered wait' })
    vi.useFakeTimers()
    const timeout = service.waitForChange(lead, 10_000, SIGNAL)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(timeout).resolves.toEqual({ timedOut: true })
    vi.useRealTimers()

    const disposed = service.waitForChange(lead, 10_000, SIGNAL)
    await fiber.dispose()
    await expect(disposed).resolves.toEqual({ timedOut: false })
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('disposes live teammate Activations and their waits when the Team service unloads', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'dispose-worker')
    await waitRunning(ctx, started.member.id)
    const waiting = ctx.agentTeams.waitForChange(lead, 10_000, SIGNAL)

    await teamFiber.dispose()

    await expect(waiting).resolves.toEqual({ timedOut: false })
    expect(ctx.agents.get(started.member.id)).toBeUndefined()
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('closes creation admission and drains an in-flight spawn before unload completes', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'])
    const service = ctx.agentTeams
    const start = ctx.subagents.startContinuable.bind(ctx.subagents)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let childId: SessionId | undefined
    vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(async (spec) => {
      childId = spec.childId
      entered.resolve(undefined)
      await release.promise
      return start(spec)
    })
    const spawning = spawn(ctx, lead, 'disposing-worker')
    const rejected = expect(spawning).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await entered.promise

    const disposal = teamFiber.dispose()
    await Promise.resolve()
    await expect(service.waitForChange(lead, 3_600_000, SIGNAL)).resolves.toEqual({ timedOut: false })
    await expect(service.spawnTeammate(lead, {
      name: 'late-worker',
      description: 'must not enter after disposal',
      prompt: content('late task'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    release.resolve(undefined)

    await rejected
    await disposal
    if (childId !== undefined) expect(ctx.agents.get(childId)).toBeUndefined()
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('retains an in-flight creation cleanup failure during disposal', async () => {
    const { ctx } = await setup([])
    const internal = teamInternals(ctx)
    const cleanupFailure = new Error('creation cleanup failed')
    const rejected = Promise.reject(cleanupFailure)
    void rejected.catch(() => undefined)
    internal.roster.inFlightCreations.add(rejected)

    await expect(internal.disposeRuntime()).rejects.toMatchObject({ errors: [cleanupFailure] })
  })

  it('recognizes wrapped and coded runtime cancellation during disposal settlement', async () => {
    const open = new TeamRuntimeLifecycle(100)
    const ordinaryFailure = new Error('ordinary failure before disposal')
    const openFailures: unknown[] = []
    await open.settle([Promise.reject(ordinaryFailure)], openFailures)
    expect(openFailures).toEqual([ordinaryFailure])

    const lifecycle = new TeamRuntimeLifecycle(100)
    lifecycle.close()
    const failures: unknown[] = []
    await lifecycle.settle([
      Promise.reject(new Error('wrapped cancellation', { cause: lifecycle.reason })),
      Promise.reject(new TeamError('translated cancellation', 'TEAM_DISPOSED')),
    ], failures)
    expect(failures).toEqual([])

    const cyclic = new Error('unrelated cyclic failure')
    cyclic.cause = cyclic
    await lifecycle.settle([Promise.reject(cyclic)], failures)
    expect(failures).toEqual([cyclic])
  })

  it('disposes a live child even after its durable member edge becomes failed', async () => {
    const { ctx, lead } = await setup(['hang'])
    const childId = SessionId('failed-live-child')
    const member = {
      id: childId,
      name: 'failed-live-worker',
      description: 'failed-live-worker responsibility',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    lead.session.append('team/member', {
      version: 2,
      teamId: TeamId(lead.id),
      member,
    })
    await ctx.subagents.startContinuable({
      childId,
      provider: 'spawn',
      label: member.description,
      request: { prompt: content('failed child task'), parent: lead },
      signal: SIGNAL,
    })
    await waitRunning(ctx, childId)
    lead.session.append('team/member', {
      version: 2,
      teamId: TeamId(lead.id),
      member: {
        ...member,
        phase: 'failed',
        error: 'creation cleanup is pending',
      },
    })
    await ctx.sessions.flush(lead.session)
    expect(ctx.agentTeams.listMembers(lead)[1]?.status).toBe('failed')

    const internal = ctx.agentTeams as unknown as { disposeRuntime(): Promise<void> }
    await internal.disposeRuntime()
    expect(ctx.agents.get(childId)).toBeUndefined()
  })

  it('aborts and awaits an admitted cold mailbox dispatch during disposal', async () => {
    const { ctx, lead } = await setup([textResponse('worker done')])
    const started = await spawn(ctx, lead, 'mailbox-worker')
    await waitNoAgent(ctx, started.member.id)
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)
      .mockImplementation(async (_parent, _childId, _content, _source, signal) => {
        entered.resolve(undefined)
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted.resolve(undefined)
            void release.promise.then(() => {
              const reason: unknown = signal.reason
              reject(reason instanceof Error ? reason : new Error(String(reason)))
            })
          }, { once: true })
        })
      })

    const sending = ctx.agentTeams.sendMessage(lead, {
      target: 'mailbox-worker',
      content: content('resume during disposal'),
      signal: SIGNAL,
    })
    await entered.promise
    const internal = ctx.agentTeams as unknown as { disposeRuntime(): Promise<void> }
    let disposed = false
    const disposal = internal.disposeRuntime().then(() => { disposed = true })
    await aborted.promise
    await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve(undefined)

    await expect(sending).resolves.toMatchObject({ status: 'queued' })
    await disposal
    expect(disposed).toBe(true)
    expect(ctx.agents.get(started.member.id)).toBeUndefined()
  })

  it('awaits an admitted asynchronous acknowledgement before disposal completes', async () => {
    const { ctx, lead } = await setup([])
    const message: TeamMessageSnapshot = {
      id: TeamMessageId('dispose-ack-message'),
      senderId: SessionId('sender'),
      senderName: 'sender',
      targetId: lead.id,
      content: content('acknowledge before disposal'),
    }
    lead.session.append('team/message/queued', {
      version: 2,
      teamId: TeamId(lead.id),
      message,
    })
    await ctx.sessions.flush(lead.session)

    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    let blockReceipt = true
    const flushSpy = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (blockReceipt && session === lead.session) {
        blockReceipt = false
        entered.resolve(undefined)
        await release.promise
      }
      return flush(session)
    })
    lead.session.append('user/message', createUserMessage({
      content: content('acknowledge before disposal'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
      },
    }), { surfaceOp: 'append' })

    const internal = ctx.agentTeams as unknown as { disposeRuntime(): Promise<void> }
    let disposed = false
    const disposal = internal.disposeRuntime().then(() => { disposed = true })
    await entered.promise
    await Promise.resolve()
    const disposedBeforeRelease = disposed
    release.resolve(undefined)
    await disposal

    expect(disposedBeforeRelease).toBe(false)
    expect(disposed).toBe(true)
    expect(durable(lead).pendingMessages).toEqual([])
    flushSpy.mockRestore()
  })

  it('bounds Team runtime disposal when a continuation drain never settles', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'], { disposalTimeoutMs: 25 })
    const started = await spawn(ctx, lead, 'stuck-worker')
    await waitRunning(ctx, started.member.id)
    const drain = vi.spyOn(ctx.subagents, 'drainContinuableChildren')
      .mockImplementation(() => new Promise(() => {}))

    const outcome = await Promise.race([
      teamFiber.dispose().then(() => 'disposed'),
      new Promise<'hung'>((resolve) => { setTimeout(() => { resolve('hung') }, 1_000) }),
    ])
    expect(outcome).toBe('disposed')
    expect(drain).toHaveBeenCalledWith(lead, [started.member.id])
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('bounds disposal while an admitted creation ignores cancellation', async () => {
    const { ctx, lead } = await setup([], { disposalTimeoutMs: 25 })
    const internal = teamInternals(ctx)
    internal.roster.inFlightCreations.add(new Promise(() => {}))

    await expect(internal.disposeRuntime()).rejects.toBeInstanceOf(AggregateError)
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'after-timeout',
      description: 'admission remains closed',
      prompt: content('must reject'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'nobody', content: content('must reject'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await expect(internal.mailbox.tryDispatch(lead, {
      id: TeamMessageId('post-disposal-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: lead.id,
      content: content('must not dispatch'),
    }, SIGNAL)).resolves.toBe(false)
  })

  it('contains recovery callback failures and ignores work scheduled after disposal', async () => {
    const { ctx, lead, teamFiber } = await setup([])
    const warnings: string[] = []
    ctx.logger.warn = ((value: unknown) => { warnings.push(String(value)) }) as typeof ctx.logger.warn
    const internal = teamInternals(ctx)
    internal.recoverFor = async () => { throw new Error('forced recovery failure') }
    internal.scheduleRecovery(lead)
    await Promise.resolve()
    await Promise.resolve()
    expect(warnings.some(warning => warning.includes('forced recovery failure'))).toBe(true)

    lead.session.append('user/message', createUserMessage({
      content: content('orphan Team source'),
      source: {
        kind: 'team-message',
        teamId: TeamId('absent-team'),
        messageId: TeamMessageId('absent-team-message'),
        senderId: SessionId('absent-sender'),
        senderName: 'absent',
      },
    }), { surfaceOp: 'append' })
    await Promise.resolve()

    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    internal.recoverFor = async () => {
      entered.resolve(undefined)
      await release.promise
      throw new Error('failure after disposal')
    }
    internal.scheduleRecovery(lead)
    await entered.promise
    await teamFiber.dispose()
    release.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    internal.scheduleRecovery(lead)
    await Promise.resolve()
  })

  it('reports contained teardown failures without retaining the Team service', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'failing-drain')
    await waitRunning(ctx, started.member.id)
    vi.spyOn(ctx.subagents, 'drainContinuableDescendants').mockRejectedValueOnce(new Error('drain failure'))

    await teamFiber.dispose()
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('reconciles mismatched persisted children and ignores a concurrently settled member', async () => {
    const first = await setup([])
    const liveId = SessionId('live-provisioning-child')
    const live = await first.ctx.agents.create({
      sessionId: liveId,
      meta: { parentSession: first.lead.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const provisioning = {
      id: liveId,
      name: 'mismatched-child',
      description: 'mismatched persisted child',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    first.lead.session.append('team/member', {
      version: 2, teamId: TeamId(first.lead.id), member: provisioning,
    })
    const reconcileFirst = teamInternals(first.ctx).roster
    await reconcileFirst.reconcileProvisioning(first.lead, SIGNAL)
    expect(durable(first.lead).members[0]?.phase).toBe('provisioning')
    live.agent.session.append('user/message', createUserMessage({
      content: content('persist mismatched child'), source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await first.ctx.sessions.flush(live.agent.session)
    await live.dispose()
    await reconcileFirst.reconcileProvisioning(first.lead, SIGNAL)
    expect(durable(first.lead).members[0]).toMatchObject({
      phase: 'failed',
      error: 'persisted child Session does not match the provisioned continuation',
    })

    const second = await setup([])
    const childId = SessionId('concurrently-settled-child')
    const member = { ...provisioning, id: childId, name: 'concurrent-child' }
    second.lead.session.append('team/member', {
      version: 2, teamId: TeamId(second.lead.id), member,
    })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(second.ctx.sessionPersistence, 'open').mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      throw new Error('late inspection failure')
    })
    const reconcileSecond = teamInternals(second.ctx).roster
    const reconciling = reconcileSecond.reconcileProvisioning(second.lead, SIGNAL)
    await entered.promise
    second.lead.session.append('team/member', {
      version: 2,
      teamId: TeamId(second.lead.id),
      member: { ...member, phase: 'failed', error: 'settled elsewhere' },
    })
    release.resolve(undefined)
    await reconciling
    expect(durable(second.lead).members[0]).toMatchObject({
      phase: 'failed', error: 'settled elsewhere',
    })
  })
})

/** Run git in one directory without a shell. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim()
}

/** One committed repository whose HEAD is a valid lane base. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-team-lane-repo-'))
  roots.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'team-lane@example.com')
  git(root, 'config', 'user.name', 'Team Lane')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'gc.auto', '0')
  git(root, 'config', 'maintenance.auto', 'false')
  writeFileSync(join(root, 'README.md'), 'base\n')
  git(root, 'add', 'README.md')
  git(root, 'commit', '-qm', 'base')
  return root
}

describe('Fleet favorites', () => {
  it('reports provider availability and fences favorite writes by revision', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-settings-'))
    roots.push(settingsRoot)
    const settingsPath = join(settingsRoot, 'settings.json')
    const { ctx, lead, teamFiber } = await setup([], {}, {}, false, settingsPath)

    expect(ctx.agentTeams.fleetAvailability(lead)).toEqual([
      expect.objectContaining({ name: 'fork', state: 'ready', continuable: true }),
      expect.objectContaining({ name: 'spawn', state: 'ready', continuable: true }),
    ])

    const favorite = {
      id: 'review-fleet',
      name: 'Review fleet',
      members: [{ name: 'reviewer', description: 'review', prompt: 'review it', provider: 'spawn' }],
    }
    const saved = await ctx.agentTeams.saveFleetFavorite(lead, favorite, 0)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error('expected save')
    expect(saved.value.favorites).toMatchObject([{
      ...favorite,
      members: [expect.objectContaining(favorite.members[0])],
    }])
    expect(saved.value.revision).toBeGreaterThan(0)

    const stale = await ctx.agentTeams.saveFleetFavorite(lead, { ...favorite, name: 'Changed' }, 0)
    expect(stale).toMatchObject({ ok: false, error: { code: 'fleet-conflict' } })
    const second = await ctx.agentTeams.saveFleetFavorite(lead, {
      id: 'other-fleet', name: 'Other fleet', members: favorite.members,
    }, saved.value.revision)
    expect(second.ok).toBe(true)
    const replaced = await ctx.agentTeams.saveFleetFavorite(lead, {
      ...favorite, name: 'Review fleet v2',
    }, second.ok ? second.value.revision : 0)
    expect(replaced.ok).toBe(true)
    const revision = replaced.ok ? replaced.value.revision : 0
    const invalid = await ctx.agentTeams.saveFleetFavorite(lead, {
      ...favorite,
      members: [{ ...favorite.members[0]!, readOnly: true, writeScopes: ['src'] }],
    }, revision)
    expect(invalid).toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_FAVORITE_INVALID' } })

    const deleted = await ctx.agentTeams.deleteFleetFavorite(lead, 'review-fleet', revision)
    expect(deleted.ok).toBe(true)
    if (deleted.ok) expect(deleted.value.favorites.map(candidate => candidate.id)).toEqual(['other-fleet'])
    expect(await ctx.agentTeams.deleteFleetFavorite(lead, 'absent', 0))
      .toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_FAVORITE_NOT_FOUND' } })
    expect(await ctx.agentTeams.launchFleetFavorite(lead, 'absent', true))
      .toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_FAVORITE_NOT_FOUND' } })
    expect(ctx.agentTeams.remoteFleetAvailability()).toEqual(ctx.agentTeams.fleetAvailability(lead))
    const harnesses = ctx.agentTeams.remoteHarnesses()
    expect(Array.isArray(harnesses)).toBe(true)
    expect(harnesses.length).toBeGreaterThan(0)
    for (const harness of harnesses) {
      expect(typeof harness.name).toBe('string')
    }
    expect(await ctx.agentTeams.remoteLaunchFleetFavorite(lead, 'absent', true))
      .toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_FAVORITE_NOT_FOUND' } })

    // The three catalog surfaces the Settings page drives reach the same service code
    // through the Remote wrappers, and each mutation still fences its write.
    expect(ctx.agentTeams.remoteFleetStarters().map(template => template.id))
      .toEqual(['development', 'research', 'quality-assurance'])
    const duplicated = await ctx.agentTeams.remoteDuplicateFleet(
      lead,
      'other-fleet',
      deleted.ok ? deleted.value.revision : 0,
    )
    expect(duplicated.ok).toBe(true)
    const installed = await ctx.agentTeams.remoteInstallStarterFleet(
      lead,
      'development',
      duplicated.ok ? duplicated.value.revision : 0,
    )
    expect(installed.ok).toBe(true)
    if (duplicated.ok && installed.ok) {
      expect(installed.value.favorites.map(candidate => candidate.id))
        .toEqual(['other-fleet', 'other-fleet-copy', 'development'])
    }

    const write = vi.spyOn(
      ctx.agentTeams as unknown as { writeFleetFavorites: (favorites: unknown, revision: number) => Promise<void> },
      'writeFleetFavorites',
    ).mockRejectedValueOnce(new Error('unexpected store failure'))
    await expect(ctx.agentTeams.saveFleetFavorite(lead, favorite, deleted.ok ? deleted.value.revision : 0))
      .rejects.toThrow('unexpected store failure')
    write.mockRestore()
    await teamFiber.dispose()
  }, 10_000)

  it('requires explicit confirmation and refuses an unavailable provider before spend', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-settings-'))
    roots.push(settingsRoot)
    const settingsPath = join(settingsRoot, 'settings.json')
    const { ctx, lead } = await setup(
      [textResponse('fleet member')],
      { fleetProviders: ['spawn', 'fork', 'missing'] },
      {},
      false,
      settingsPath,
    )
    const favorite = {
      id: 'mixed',
      name: 'Mixed fleet',
      members: [
        { name: 'ready-member', description: 'ready', prompt: 'run', provider: 'spawn' },
        { name: 'missing-member', description: 'missing', prompt: 'run', provider: 'missing' },
      ],
    }
    const saved = await ctx.agentTeams.saveFleetFavorite(lead, favorite, 0)
    if (!saved.ok) throw new Error(saved.error.message)

    expect(await ctx.agentTeams.launchFleetFavorite(lead, 'mixed', false))
      .toMatchObject({ ok: false, error: { code: 'fleet-confirmation-required' } })
    const refused = await ctx.agentTeams.launchFleetFavorite(lead, 'mixed', true)
    expect(refused).toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_PROVIDER_UNAVAILABLE' } })
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)

    const single = {
      id: 'single',
      name: 'Single member',
      members: [{ name: 'solo', description: 'solo', prompt: 'run', provider: 'spawn' }],
    }
    const savedSingle = await ctx.agentTeams.saveFleetFavorite(lead, single, saved.value.revision)
    if (!savedSingle.ok) throw new Error(savedSingle.error.message)
    const launched = await ctx.agentTeams.launchFleetFavorite(lead, 'single', true)
    expect(launched.ok).toBe(true)
    if (launched.ok) {
      expect(launched.value.members).toHaveLength(1)
      await waitNoAgent(ctx, launched.value.members[0]!.id)
    }
    expect(ctx.agentTeams.listMembers(lead).some(member => member.name === 'solo')).toBe(true)

    // A stored timeout belongs to a Melody member. A Harmony member keeps its
    // turn and is interrupted instead, so the launch refuses it loudly rather
    // than dropping a setting the fleet appears to save.
    const timedLane = {
      id: 'timed-lane',
      name: 'Timed lane',
      members: [{ name: 'laner', description: 'lane', prompt: 'run', provider: 'fork', timeoutMs: 1_000 }],
    }
    const savedTimed = await ctx.agentTeams.saveFleetFavorite(lead, timedLane, savedSingle.value.revision)
    if (!savedTimed.ok) throw new Error(savedTimed.error.message)
    const refusedTimeout = await ctx.agentTeams.launchFleetFavorite(lead, 'timed-lane', true)
    expect(refusedTimeout).toMatchObject({ ok: false, error: { code: 'fleet-member-failed' } })
    if (!refusedTimeout.ok) {
      expect(refusedTimeout.error.message).toContain('timeoutMs applies to a Melody member')
    }
  }, 20_000)

  it('refuses a disabled fleet, duplicates a saved fleet, and installs a starter as editable', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-settings-'))
    roots.push(settingsRoot)
    const { ctx, lead } = await setup(
      [textResponse('fleet member')],
      {},
      {},
      false,
      join(settingsRoot, 'settings.json'),
    )
    const favorite = {
      id: 'review',
      name: 'Review',
      enabled: false,
      members: [{ name: 'reviewer', description: 'review', prompt: 'run', provider: 'spawn' }],
    }
    const saved = await ctx.agentTeams.saveFleetFavorite(lead, favorite, 0)
    if (!saved.ok) throw new Error(saved.error.message)

    // A disabled fleet stays saved and refuses to launch by name.
    expect(await ctx.agentTeams.launchFleetFavorite(lead, 'review', true))
      .toMatchObject({ ok: false, error: { code: 'fleet-disabled' } })

    const copied = await ctx.agentTeams.duplicateFleet(lead, 'review', saved.value.revision)
    if (!copied.ok) throw new Error(copied.error.message)
    expect(copied.value.favorites.map(candidate => candidate.id)).toEqual(['review', 'review-copy'])
    expect(copied.value.favorites.find(candidate => candidate.id === 'review-copy')?.name)
      .toBe('Review (copy)')

    const installed = await ctx.agentTeams.installStarterFleet(lead, 'research', copied.value.revision)
    if (!installed.ok) throw new Error(installed.error.message)
    const research = installed.value.favorites.find(candidate => candidate.id === 'research')
    expect(research?.members.length).toBeGreaterThan(1)

    // An unknown template names what does exist, and a missing source is its own refusal.
    const unknown = await ctx.agentTeams.installStarterFleet(lead, 'deploy', installed.value.revision)
    expect(unknown).toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_TEMPLATE_UNKNOWN' } })
    if (unknown.ok) throw new Error('expected the unknown template to be refused')
    expect(unknown.error.message).toContain('development, research, quality-assurance')
    expect(await ctx.agentTeams.duplicateFleet(lead, 'absent', installed.value.revision))
      .toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_FAVORITE_NOT_FOUND' } })
  }, 20_000)

  it('starts a fleet in concurrency batches and keeps sibling members alive when one fails', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-settings-'))
    roots.push(settingsRoot)
    const { ctx, lead } = await setup(
      [textResponse('first'), textResponse('second'), textResponse('third'), textResponse('clash')],
      {},
      {},
      false,
      join(settingsRoot, 'settings.json'),
    )
    // An existing teammate supplies a name the fleet will collide with, which is
    // a deterministic mid-launch failure rather than a timed or flaky one.
    const taken = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'clash',
      description: 'existing',
      prompt: [{ type: 'text', text: 'hold the name' }],
      context: 'fresh',
      provider: 'spawn',
      signal: new AbortController().signal,
    })
    expect(taken.member.name).toBe('clash')

    const favorite = {
      id: 'wide',
      name: 'Wide fleet',
      concurrency: 3,
      members: [
        { name: 'alpha', description: 'a', prompt: 'run', provider: 'spawn' },
        { name: 'clash', description: 'b', prompt: 'run', provider: 'spawn' },
        { name: 'beta', description: 'c', prompt: 'run', provider: 'spawn' },
      ],
    }
    const saved = await ctx.agentTeams.saveFleetFavorite(lead, favorite, 0)
    if (!saved.ok) throw new Error(saved.error.message)

    const refused = await ctx.agentTeams.launchFleetFavorite(lead, 'wide', true)
    expect(refused).toMatchObject({ ok: false, error: { code: 'fleet-member-failed' } })
    if (refused.ok) throw new Error('expected the colliding member to fail the launch')
    expect(refused.error.message).toContain('"clash"')
    expect(refused.error.message).toContain('2 sibling(s) started')

    // The two siblings that started are real roster members: one member's failure
    // cancelled neither of them, and the fleet did not roll back.
    expect(ctx.agentTeams.listMembers(lead).map(member => member.name).sort())
      .toEqual(['alpha', 'beta', 'clash', 'lead'])
  }, 30_000)

  it('admits no more members at once than the fleet concurrency allows', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-paced-'))
    roots.push(settingsRoot)
    const { ctx, lead } = await setup(
      [textResponse('a'), textResponse('b'), textResponse('c'), textResponse('d')],
      {},
      {},
      false,
      join(settingsRoot, 'settings.json'),
    )
    const saved = await ctx.agentTeams.saveFleetFavorite(lead, {
      id: 'paced',
      name: 'Paced fleet',
      concurrency: 2,
      members: [
        { name: 'm1', description: 'a', prompt: 'run', provider: 'spawn' },
        { name: 'm2', description: 'b', prompt: 'run', provider: 'spawn' },
        { name: 'm3', description: 'c', prompt: 'run', provider: 'spawn' },
        { name: 'm4', description: 'd', prompt: 'run', provider: 'spawn' },
      ],
    }, 0)
    if (!saved.ok) throw new Error(saved.error.message)

    // Each spawn is held at the admission seam, so a third start could only appear
    // if the launch loop did not wait for its batch. Real spawning then proceeds
    // unchanged, which keeps the roster members genuine.
    const starts: string[] = []
    const held: Array<() => void> = []
    let inFlight = 0
    let peak = 0
    const real = ctx.agentTeams.spawnTeammate.bind(ctx.agentTeams)
    const spy = vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockImplementation(async (caller, request) => {
      starts.push(request.name)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => { held.push(resolve) })
      inFlight -= 1
      return await real(caller, request)
    })

    const launched = ctx.agentTeams.launchFleetFavorite(lead, 'paced', true)
    await vi.waitFor(() => { expect(starts).toEqual(['m1', 'm2']) })
    expect(held).toHaveLength(2)
    held.forEach((release) => { release() })

    await vi.waitFor(() => { expect(starts).toHaveLength(4) })
    held.forEach((release) => { release() })
    const result = await launched
    spy.mockRestore()

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.members.map(member => member.name).sort()).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(peak).toBe(2)
  }, 30_000)

  it('reports every failed member of one launch batch, not only the last', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-batch-'))
    roots.push(settingsRoot)
    const { ctx, lead } = await setup(
      ['hang', 'hang', 'hang'],
      {},
      {},
      false,
      join(settingsRoot, 'settings.json'),
    )
    // Two teammates already hold the names the fleet will ask for, so the whole
    // batch fails deterministically - the shape that hides a failure when only the
    // last outcome of a batch is reported.
    for (const name of ['one', 'two']) {
      await spawn(ctx, lead, name)
    }
    const saved = await ctx.agentTeams.saveFleetFavorite(lead, {
      id: 'collide',
      name: 'Collide',
      concurrency: 2,
      members: [
        { name: 'one', description: 'a', prompt: 'run', provider: 'spawn' },
        { name: 'two', description: 'b', prompt: 'run', provider: 'spawn' },
      ],
    }, 0)
    if (!saved.ok) throw new Error(saved.error.message)

    const refused = await ctx.agentTeams.launchFleetFavorite(lead, 'collide', true)
    expect(refused).toMatchObject({ ok: false, error: { code: 'fleet-member-failed' } })
    if (refused.ok) throw new Error('expected the colliding batch to fail')
    expect(refused.error.message).toContain('2 member(s) failed')
    expect(refused.error.message).toContain('"one"')
    expect(refused.error.message).toContain('"two"')
  }, 30_000)

  it('refuses a fleet mutation from a teammate', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-fleet-teammate-'))
    roots.push(settingsRoot)
    const { ctx, lead } = await setup(['hang'], {}, {}, false, join(settingsRoot, 'settings.json'))
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)

    // Duplicating and installing write the shared fleet section, so they need the
    // same Lead authority that saving and deleting already required.
    await expect(ctx.agentTeams.duplicateFleet(worker, 'anything', 0))
      .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    await expect(ctx.agentTeams.installStarterFleet(worker, 'research', 0))
      .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    expect(ctx.agentTeams.fleetFavorites(worker).favorites).toEqual([])
  }, 20_000)

  it('fails closed when the fleet settings namespace is not mounted', async () => {
    const { ctx, lead } = await setup([])
    expect(() => ctx.agentTeams.fleetFavorites(lead))
      .toThrow('fleet settings namespace is not mounted')
    expect(await ctx.agentTeams.saveFleetFavorite(lead, {
      id: 'x', name: 'X', members: [{ name: 'x', description: 'x', prompt: 'x', provider: 'spawn' }],
    }, 0)).toMatchObject({ ok: false, error: { code: 'TEAM_FLEET_SETTINGS_UNAVAILABLE' } })
  })
})

describe('One-shot members', () => {
  /** One-shot provider registration plus the observations the tests assert on. */
  function oneShot(
    ctx: Context,
    name: string,
    options: {
      /** Created when the provider is asked to start, so a rejection is always awaited. */
      readonly result?: () => Promise<SubagentResult>
    } = {},
  ): { readonly dispositions: number[]; signal(): AbortSignal | undefined } {
    const dispositions: number[] = []
    let seen: AbortSignal | undefined
    ctx.subagents.registerProvider({
      name,
      capabilities: {
        agentOptions: false,
        outputSchema: false,
        depthLimit: false,
        toolFilter: false,
        persona: false,
        agentPreset: false,
      },
      inheritsParentContext: false,
      start: async (request: { signal: AbortSignal }) => {
        seen = request.signal
        return {
          id: SessionId('one-shot-run'),
          localAgent: undefined,
          result: options.result?.() ?? Promise.resolve({ output: content('cli answer'), stopReason: 'completed' }),
          dispose: async () => { dispositions.push(1) },
        }
      },
    })
    return {
      dispositions,
      signal: () => seen,
    }
  }

  /** The durable roster row for one member name, read through the Team projection. */
  function rowOf(ctx: Context, lead: Agent, name: string): Record<string, unknown> | undefined {
    const state = ctx.sessionProjections.stateOf(lead.session, 'agentTeam') as unknown as
      | { readonly members: readonly Record<string, unknown>[]; readonly failure?: string }
      | undefined
    // A refused Team event stops the projection where it stands, so a row read after
    // one would otherwise look merely stale.
    if (state?.failure !== undefined) throw new Error(`Team projection failed: ${state.failure}`)
    return state?.members.find(candidate => candidate.name === name)
  }

  function spawnOneShot(ctx: Context, lead: Agent, name: string, provider: string, extra: Record<string, unknown> = {}) {
    return ctx.agentTeams.spawnTeammate(lead, {
      name,
      description: `${name} responsibility`,
      prompt: content(`${name} initial`),
      context: 'fresh',
      provider,
      signal: SIGNAL,
      ...extra,
    })
  }

  /**
   * Let real Session I/O progress while the fake clock is installed.
   *
   * Every Team append flushes through the persistence writer, so a settlement needs
   * more than a clock advance: its continuation runs on the real event loop, which
   * fake timers do not run. Yielding between ticks keeps durable-state assertions
   * deterministic without depending on wall-clock speed.
   */
  async function drainClock(): Promise<void> {
    await vi.runOnlyPendingTimersAsync()
    await new Promise<void>((resolve) => {
      process.nextTick(resolve)
    })
  }

  /**
   * Drive the fake clock until one member's settlement is durable.
   * @param ctx - Team service context.
   * @param lead - exact live Lead owning the roster.
   * @param name - member whose row is awaited.
   * @param phase - phase the row must reach.
   */
  async function awaitSettled(ctx: Context, lead: Agent, name: string, phase: string): Promise<void> {
    for (let pump = 0; pump < 300; pump += 1) {
      await drainClock()
      if (rowOf(ctx, lead, name)?.phase === phase) return
    }
    expect(rowOf(ctx, lead, name), `teammate "${name}" never reached ${phase}`)
      .toMatchObject({ phase })
  }

  it('dispatches through start, never startContinuable, and settles the row as completed', async () => {
    const { ctx, lead } = await setup([])
    const provider = oneShot(ctx, 'ext-cli')
    const continuable = vi.spyOn(ctx.subagents, 'startContinuable')
    await spawnOneShot(ctx, lead, 'worker', 'ext-cli')
    expect(continuable).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'worker')?.phase).toBe('completed') }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'worker')).toMatchObject({
      mode: 'one-shot',
      result: { stopReason: 'completed', output: content('cli answer') },
    })
    // Disposal happens exactly once, and the row is no longer interactive.
    expect(provider.dispositions).toHaveLength(1)
  })

  it('preserves stopReason, output, and provider diagnostic on a partial run', async () => {
    const { ctx, lead } = await setup([])
    oneShot(ctx, 'ext-partial', {
      result: () => Promise.resolve({ output: content('partial work'), stopReason: 'error', diagnostic: 'provider refused' }),
    })
    await spawnOneShot(ctx, lead, 'partial', 'ext-partial')
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'partial')?.phase).toBe('completed') }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'partial')?.result).toEqual({
      stopReason: 'error',
      output: content('partial work'),
      diagnostic: 'provider refused',
    })
  })

  it('refuses messages, follow-ups, and interruption on a running one-shot member', async () => {
    const { ctx, lead } = await setup([])
    const settled = Promise.withResolvers<SubagentResult>()
    oneShot(ctx, 'ext-hold', { result: () => settled.promise })
    await spawnOneShot(ctx, lead, 'held', 'ext-hold')
    expect(rowOf(ctx, lead, 'held')?.phase).toBe('active')

    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'held', content: content('follow up'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_INTERACTIVE' })
    expect(() => ctx.agentTeams.interrupt(lead, 'held')).toThrow(/runs Melody/)

    settled.resolve({ output: content('late'), stopReason: 'completed' })
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'held')?.phase).toBe('completed') }, { timeout: 5_000 })
  })

  it('carries caller cancellation to the provider signal and settles exactly once', async () => {
    const { ctx, lead } = await setup([])
    const finished = Promise.withResolvers<SubagentResult>()
    const provider = oneShot(ctx, 'ext-cancel', { result: () => finished.promise })
    const controller = new AbortController()
    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'cancelled',
      description: 'one-shot',
      prompt: content('run'),
      context: 'fresh',
      provider: 'ext-cancel',
      signal: controller.signal,
    })
    const seen = provider.signal()
    expect(seen?.aborted).toBe(false)
    controller.abort('user cancelled')
    expect(seen?.aborted).toBe(true)
    // A provider that reports its own cancellation settles through the same single
    // path as any other result.
    finished.resolve({ output: content('stopped early'), stopReason: 'aborted' })
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'cancelled')?.phase).toBe('completed') }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'cancelled')?.result).toEqual({ stopReason: 'aborted', output: content('stopped early') })
    expect(provider.dispositions).toHaveLength(1)
  })

  it('settles a never-finishing run as a timeout deterministically, disposing once', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, lead } = await setup([])
      const provider = oneShot(ctx, 'ext-stall', { result: () => Promise.withResolvers<never>().promise })
      await spawnOneShot(ctx, lead, 'stalled', 'ext-stall', { timeoutMs: 5_000 })
      await vi.advanceTimersByTimeAsync(5_000)
      // The settlement queue now holds two appends for one member: the Lead-directed
      // report and the terminal edge. Both are durable before the row is read.
      await awaitSettled(ctx, lead, 'stalled', 'completed')
      expect(rowOf(ctx, lead, 'stalled')).toMatchObject({
        phase: 'completed',
        result: { stopReason: 'timeout' },
      })
      expect(String(rowOf(ctx, lead, 'stalled')?.error)).toContain('Melody member "stalled" exceeded its 5000ms budget')
      // The expiry cancels the run at its source, not merely the local wait.
      expect(provider.signal()?.aborted).toBe(true)
      expect(provider.dispositions).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a successful sibling result intact when another one-shot member fails', async () => {
    const { ctx, lead } = await setup([])
    oneShot(ctx, 'ext-ok')
    oneShot(ctx, 'ext-bad', { result: () => Promise.reject(new Error('provider exploded')) })
    await spawnOneShot(ctx, lead, 'keeper', 'ext-ok')
    await spawnOneShot(ctx, lead, 'breaker', 'ext-bad')
    await vi.waitFor(() => {
      expect(rowOf(ctx, lead, 'keeper')?.phase).toBe('completed')
      expect(rowOf(ctx, lead, 'breaker')?.phase).toBe('completed')
    }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'keeper')?.result).toEqual({ stopReason: 'completed', output: content('cli answer') })
    expect(rowOf(ctx, lead, 'breaker')).toMatchObject({
      result: { stopReason: 'error' },
      error: 'provider exploded',
    })
  })

  it('settles once when the run arrives before its budget expires', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, lead } = await setup([])
      const finished = Promise.withResolvers<SubagentResult>()
      const provider = oneShot(ctx, 'ext-early', { result: () => finished.promise })
      await spawnOneShot(ctx, lead, 'quick', 'ext-early', { timeoutMs: 10_000 })
      await vi.advanceTimersByTimeAsync(3_000)
      finished.resolve({ output: content('arrived first'), stopReason: 'completed' })
      await vi.advanceTimersByTimeAsync(20_000)
      await awaitSettled(ctx, lead, 'quick', 'completed')
      // The budget timer is cleared at settlement, so it cannot append a second
      // terminal edge: durable() throws on any projection failure.
      expect(durable(lead).members.find(member => member.name === 'quick')).toMatchObject({
        phase: 'completed',
        result: { stopReason: 'completed', output: content('arrived first') },
      })
      expect(durable(lead).members.find(member => member.name === 'quick')).not.toHaveProperty('error')
      expect(provider.dispositions).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards a provider failure that surfaces after the budget expired', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, lead } = await setup([])
      const finished = Promise.withResolvers<SubagentResult>()
      const provider = oneShot(ctx, 'ext-late', { result: () => finished.promise })
      await spawnOneShot(ctx, lead, 'stale', 'ext-late', { timeoutMs: 5_000 })
      await vi.advanceTimersByTimeAsync(5_000)
      await awaitSettled(ctx, lead, 'stale', 'completed')
      expect(rowOf(ctx, lead, 'stale')).toMatchObject({ phase: 'completed', result: { stopReason: 'timeout' } })
      finished.reject(new Error('provider failed after expiry'))
      await vi.advanceTimersByTimeAsync(0)
      await vi.runAllTimersAsync()
      // The row already holds its terminal edge; the late rejection is observed and
      // dropped instead of re-settling the member or disposing the run twice.
      expect(rowOf(ctx, lead, 'stale')?.result).toEqual({ stopReason: 'timeout' })
      expect(provider.dispositions).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps a provider rejection inside an active budget to an error result', async () => {
    const { ctx, lead } = await setup([])
    const provider = oneShot(ctx, 'ext-throws', { result: () => Promise.reject(new Error('cli crashed')) })
    await spawnOneShot(ctx, lead, 'crashed', 'ext-throws', { timeoutMs: 60_000 })
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'crashed')?.phase).toBe('completed') }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'crashed')).toMatchObject({
      result: { stopReason: 'error' },
      error: 'cli crashed',
    })
    expect(provider.dispositions).toHaveLength(1)
  })

  it('records a run without output and lists the settled member as inactive', async () => {
    const { ctx, lead } = await setup([])
    oneShot(ctx, 'ext-silent', { result: () => Promise.resolve({ output: [], stopReason: 'refusal' }) })
    await spawnOneShot(ctx, lead, 'silent', 'ext-silent')
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'silent')?.phase).toBe('completed') }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'silent')?.result).toEqual({ stopReason: 'refusal' })
    // A settled one-shot is terminal: the roster has no live child to report, and it
    // no longer resolves as a messaging target.
    expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'silent'))
      .toMatchObject({ status: 'inactive' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'silent', content: content('too late'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
  })

  it('settles an unfinished one-shot member as failed during recovery', async () => {
    const { ctx, lead } = await setup([])
    lead.session.append('team/member', {
      version: 2,
      teamId: TeamId(lead.id),
      member: {
        id: SessionId('orphaned-one-shot'),
        name: 'orphan',
        description: 'run lost with the previous process',
        provider: 'ext-orphan',
        context: 'fresh',
        phase: 'provisioning',
        mode: 'one-shot',
      },
    })
    await teamInternals(ctx).roster.reconcileProvisioning(lead, SIGNAL)
    // Recovery has no lane to resume, so the row ends failed instead of becoming an
    // interactive teammate the Lead could keep messaging.
    expect(rowOf(ctx, lead, 'orphan')).toMatchObject({ phase: 'failed' })
    expect(String(rowOf(ctx, lead, 'orphan')?.error)).toContain('child Session recovery failed')
    expect(() => ctx.agentTeams.interrupt(lead, 'orphan')).toThrow(/not found/u)
  })

  it('keeps a row recorded before the mode field interactive as a lane', async () => {
    const { ctx, lead } = await setup([])
    const legacy = {
      id: SessionId('legacy-child'),
      name: 'legacy',
      description: 'recorded before member modes existed',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    lead.session.append('team/member', { version: 2, teamId: TeamId(lead.id), member: legacy })
    lead.session.append('team/member', {
      version: 2,
      teamId: TeamId(lead.id),
      member: { ...legacy, phase: 'active' as const },
    })
    await ctx.sessions.flush(lead.session)
    // An absent mode is a lane, so the mailbox keeps queueing for it rather than
    // refusing it as non-interactive.
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'legacy', content: content('queued for a lane'), signal: SIGNAL,
    })).resolves.toMatchObject({ status: 'queued' })
    expect(() => ctx.agentTeams.interrupt(lead, 'legacy')).not.toThrow(/runs Melody/u)
  })

  it('reports a settlement whose first durable write is refused', async () => {
    const { ctx, lead } = await setup([])
    const finished = Promise.withResolvers<SubagentResult>()
    const provider = oneShot(ctx, 'ext-unrecorded', { result: () => finished.promise })
    await spawnOneShot(ctx, lead, 'lost', 'ext-unrecorded')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(teamInternals(ctx).journal, 'appendAndFlush').mockRejectedValueOnce(new Error('durable append refused'))
    finished.resolve({ output: content('arrived'), stopReason: 'completed' })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('teammate "lost" settlement did not complete'))
    }, { timeout: 5_000 })
    // Neither the report nor the terminal edge was written, the run is still disposed
    // once, and restart reconciliation ends the member rather than leaving a second
    // settlement pending.
    expect(rowOf(ctx, lead, 'lost')?.phase).toBe('active')
    expect(provider.dispositions).toHaveLength(1)
  })

  /** How often one item was steered into the Lead; a claimed inbox entry repeats its text. */
  function steeredCount(lead: Agent, id: string): number {
    return lead.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced')
      .filter(event => event.data.inserted.some(input => input.source.kind === 'team-message'
        && input.source.messageId === id)).length
  }

  /** Peer items the Lead's own Session recorded, with the text a model would read. */
  function leadReceipts(lead: Agent): { id: string; sender: string; text: string }[] {
    return lead.session.snapshotEvents().flatMap((event) => {
      if (event.type === 'user/message') {
        if (event.data.source.kind !== 'team-message') return []
        return [{
          id: event.data.source.messageId,
          sender: event.data.source.senderName,
          text: event.data.content.map(block => block.type === 'text' ? block.text : '').join(' '),
        }]
      }
      if (event.type !== 'agent/inbox/spliced') return []
      return event.data.inserted.flatMap((input) => {
        if (input.source.kind !== 'team-message') return []
        return [{
          id: input.source.messageId,
          sender: input.source.senderName,
          text: input.content.map(block => block.type === 'text' ? block.text : '').join(' '),
        }]
      })
    })
  }

  /** The settled member's report identity, derived the way the mailbox derives it. */
  function reportId(ctx: Context, lead: Agent, name: string): string {
    return `team-message-${String(rowOf(ctx, lead, name)?.id)}`
  }

  /** Wait for one member's report to reach the Lead, then return its identity. */
  async function waitReceipt(ctx: Context, lead: Agent, name: string): Promise<string> {
    const id = reportId(ctx, lead, name)
    await vi.waitFor(() => {
      expect(leadReceipts(lead).some(receipt => receipt.id === id)).toBe(true)
    }, { timeout: 5_000 })
    return id
  }

  it('reports a successful one-shot result to the Lead exactly once', async () => {
    const { ctx, lead } = await setup(['hang'])
    oneShot(ctx, 'ext-report')
    await spawnOneShot(ctx, lead, 'reporter', 'ext-report')
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'reporter')?.phase).toBe('completed') }, { timeout: 5_000 })
    const id = await waitReceipt(ctx, lead, 'reporter')
    const receipt = leadReceipts(lead).find(candidate => candidate.id === id)!
    expect(receipt.sender).toBe('reporter')
    expect(receipt.text).toContain('Melody teammate "reporter" settled with stop reason "completed" on provider "ext-report".')
    // The user-facing name is vocabulary only: the durable row keeps the stored mode.
    expect(rowOf(ctx, lead, 'reporter')?.mode).toBe('one-shot')
    expect(receipt.text).toContain('Final assistant output:')
    expect(receipt.text).toContain('cli answer')
    expect(durable(lead).pendingMessages).toEqual([])
    // Exactly one queue edge and one acknowledgement exist for the member, so no
    // second settlement or dispatch produced a second report.
    const edges = lead.session.snapshotEvents().filter(event => event.type === 'team/message/queued'
      || event.type === 'team/message/delivered')
      .filter(event => (event.type === 'team/message/queued'
        ? event.data.message.id === id
        : event.data.messageId === id))
    expect(edges.map(event => event.type)).toEqual(['team/message/queued', 'team/message/delivered'])
  })

  it('reports a failed one-shot member with its failure detail', async () => {
    const { ctx, lead } = await setup(['hang'])
    oneShot(ctx, 'ext-boom', { result: () => Promise.reject(new Error('cli crashed')) })
    await spawnOneShot(ctx, lead, 'crashy', 'ext-boom')
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'crashy')?.phase).toBe('completed') }, { timeout: 5_000 })
    const id = await waitReceipt(ctx, lead, 'crashy')
    const text = leadReceipts(lead).find(candidate => candidate.id === id)!.text
    expect(text).toContain('settled with stop reason "error"')
    expect(text).toContain('roster recorded: cli crashed')
    expect(text).toContain('The run produced no output.')
  })

  it('reports a budget expiry and an aborted run as distinct outcomes', async () => {
    vi.useFakeTimers()
    try {
      const first = await setup(['hang'])
      oneShot(first.ctx, 'ext-timeout', { result: () => Promise.withResolvers<never>().promise })
      await spawnOneShot(first.ctx, first.lead, 'slow', 'ext-timeout', { timeoutMs: 5_000 })
      await vi.advanceTimersByTimeAsync(5_000)
      await awaitSettled(first.ctx, first.lead, 'slow', 'completed')
      const timedOutId = reportId(first.ctx, first.lead, 'slow')
      for (let pump = 0; pump < 300; pump += 1) {
        await drainClock()
        if (leadReceipts(first.lead).some(receipt => receipt.id === timedOutId)) break
      }
      const timedOut = leadReceipts(first.lead)
        .find(receipt => receipt.id === timedOutId)
      expect(timedOut?.text).toContain('settled with stop reason "timeout"')
      expect(timedOut?.text).toContain('roster recorded: Melody member "slow" exceeded its 5000ms budget and was cancelled')

      const second = await setup(['hang'])
      const finished = Promise.withResolvers<SubagentResult>()
      oneShot(second.ctx, 'ext-abort', { result: () => finished.promise })
      const controller = new AbortController()
      await second.ctx.agentTeams.spawnTeammate(second.lead, {
        name: 'cancelled',
        description: 'one-shot',
        prompt: content('run'),
        context: 'fresh',
        provider: 'ext-abort',
        signal: controller.signal,
      })
      controller.abort('user cancelled')
      finished.resolve({ output: content('stopped early'), stopReason: 'aborted' })
      await vi.waitFor(() => {
        expect(leadReceipts(second.lead).some(receipt => receipt.text.includes('stop reason "aborted"')))
          .toBe(true)
      }, { timeout: 5_000 })
      const receipt = leadReceipts(second.lead).find(candidate => candidate.text.includes('stop reason "aborted"'))!
      expect(receipt.text).toContain('stopped early')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an undeliverable report queued and retries it without duplicating', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    oneShot(ctx, 'ext-retry')
    await spawnOneShot(ctx, lead, 'queued', 'ext-retry')
    vi.spyOn(lead, 'steer').mockImplementationOnce(() => { throw new Error('Lead inbox busy') })
    const id = reportId(ctx, lead, 'queued')
    await vi.waitFor(() => {
      expect(durable(lead).pendingMessages.map(message => message.id)).toContain(id)
    }, { timeout: 5_000 })
    expect(steeredCount(lead, id)).toBe(0)

    const pending = durable(lead).pendingMessages.find(message => message.id === id)!
    await expect(teamInternals(ctx).mailbox.tryDispatch(lead, pending, SIGNAL)).resolves.toBe(true)
    expect(steeredCount(lead, id)).toBe(1)
    expect(durable(lead).pendingMessages).toEqual([])
  })

  it('keeps the report durable when the terminal edge cannot be written', async () => {
    const { ctx, lead } = await setup(['hang'])
    oneShot(ctx, 'ext-halfwrite')
    await spawnOneShot(ctx, lead, 'half', 'ext-halfwrite')
    const journal = teamInternals(ctx).journal
    const forward = journal.appendAndFlush.bind(journal)
    vi.spyOn(journal, 'appendAndFlush').mockImplementation(async (root, type, data) => {
      if (type === 'team/member') throw new Error('roster write refused')
      await forward(root, type, data)
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const id = reportId(ctx, lead, 'half')
    await vi.waitFor(() => {
      expect(durable(lead).pendingMessages.map(message => message.id)).toContain(id)
    }, { timeout: 5_000 })
    // The member keeps its active edge and the warning names it, so nothing claims a
    // terminal row that was never written.
    expect(rowOf(ctx, lead, 'half')?.phase).toBe('active')
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('teammate "half" settlement did not complete'))
    }, { timeout: 5_000 })
    // The queued report survives on its own: recovery delivers it without a second
    // settlement attempt.
    await teamInternals(ctx).recoverFor(lead)
    expect(steeredCount(lead, id)).toBe(1)
  })

  it('reports each settled member separately and keeps a sibling report intact', async () => {
    const { ctx, lead } = await setup(['hang', 'hang', 'hang'])
    oneShot(ctx, 'ext-a', { result: () => Promise.resolve({ output: content('answer A'), stopReason: 'completed' }) })
    oneShot(ctx, 'ext-b', { result: () => Promise.reject(new Error('provider B died')) })
    await spawnOneShot(ctx, lead, 'alpha', 'ext-a')
    await spawnOneShot(ctx, lead, 'beta', 'ext-b')
    const alphaId = await waitReceipt(ctx, lead, 'alpha')
    const betaId = await waitReceipt(ctx, lead, 'beta')
    const alpha = leadReceipts(lead).find(candidate => candidate.id === alphaId)!
    const beta = leadReceipts(lead).find(candidate => candidate.id === betaId)!
    expect(alpha.text).toContain('answer A')
    expect(beta.text).toContain('stop reason "error"')
    expect(beta.text).toContain('provider B died')
    expect(rowOf(ctx, lead, 'alpha')?.result).toEqual({ stopReason: 'completed', output: content('answer A') })
    expect(rowOf(ctx, lead, 'beta')).toMatchObject({ result: { stopReason: 'error' }, error: 'provider B died' })
  })

  it('withholds output that cannot fit one Team message and names where it stays', async () => {
    const { ctx, lead } = await setup(['hang'], { maxMessageBytes: 320 })
    oneShot(ctx, 'ext-big', { result: () => Promise.resolve({ output: content('x'.repeat(900)), stopReason: 'completed' }) })
    await spawnOneShot(ctx, lead, 'verbose', 'ext-big')
    await vi.waitFor(() => { expect(rowOf(ctx, lead, 'verbose')?.phase).toBe('completed') }, { timeout: 5_000 })
    const id = await waitReceipt(ctx, lead, 'verbose')
    const text = leadReceipts(lead).find(candidate => candidate.id === id)!.text
    expect(text).toContain('exceeded the 320-byte Team message limit')
    expect(text).toContain('stays recorded whole on teammate "verbose"\'s roster row')
    expect(text).not.toContain('xxxx')
    // The durable row keeps the complete output the report could not carry.
    expect(rowOf(ctx, lead, 'verbose')?.result).toEqual({ stopReason: 'completed', output: content('x'.repeat(900)) })
  })

  it('refuses lane-only shapes on each side of the split', async () => {
    const { ctx, lead } = await setup([])
    oneShot(ctx, 'ext-mixed')
    await expect(spawnOneShot(ctx, lead, 'budgeted', 'spawn', { timeoutMs: 1_000 }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(spawnOneShot(ctx, lead, 'isolated', 'ext-mixed', { writeScopes: ['src'] }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_LANE_POLICY' })
    // A continuable member is still recorded as a lane, so recovery and messaging
    // keep their existing meaning.
    const lane = await spawnOneShot(ctx, lead, 'normal', 'spawn')
    expect(rowOf(ctx, lead, 'normal')).toMatchObject({ phase: 'active', mode: 'lane' })
    expect(lane.member.role).toBe('teammate')
  })

  it('names every Lead-visible and model-visible Team string in Harmony and Melody', async () => {
    const { ctx, lead } = await setup([])
    oneShot(ctx, 'ext-terms')
    await expect(spawnOneShot(ctx, lead, 'budgeted', 'spawn', { timeoutMs: 1_000 }))
      .rejects.toThrow('timeoutMs applies to a Melody member; interrupt a Harmony teammate instead')
    await expect(spawnOneShot(ctx, lead, 'isolated', 'ext-terms', { writeScopes: ['src'] }))
      .rejects.toThrow('a Melody member has no Harmony lane to checkpoint')

    await spawnOneShot(ctx, lead, 'runner', 'ext-terms')
    const id = await waitReceipt(ctx, lead, 'runner')
    const text = leadReceipts(lead).find(candidate => candidate.id === id)!.text
    // The report the Lead reads carries the mode name and none of the retired internal
    // vocabulary, while the roster row keeps the stored value the projection validates.
    expect(text).toContain('Melody teammate "runner" settled with stop reason "completed"')
    expect(text).not.toContain('one-shot')
    expect(rowOf(ctx, lead, 'runner')?.mode).toBe('one-shot')
  })

  it('launches one fleet that mixes a continuable lane with a one-shot CLI-style member', async () => {
    const settingsRoot = mkdtempSync(join(tmpdir(), 'gnk-team-mixed-fleet-'))
    roots.push(settingsRoot)
    const { ctx, lead } = await setup(['hang', 'hang'], {}, {}, false, join(settingsRoot, 'settings.json'))
    const provider = oneShot(ctx, 'ext-cli')
    const continuable = vi.spyOn(ctx.subagents, 'startContinuable')
    // Availability names each shape before any spend, so the editor and the
    // launcher cannot disagree about what the composition registers.
    expect(ctx.agentTeams.fleetAvailability(lead).find(row => row.name === 'ext-cli'))
      .toMatchObject({ state: 'one-shot', oneShot: true, continuable: false })
    expect(ctx.agentTeams.fleetAvailability(lead).find(row => row.name === 'spawn'))
      .toMatchObject({ state: 'ready', oneShot: true, continuable: true })

    const saved = await ctx.agentTeams.saveFleetFavorite(lead, {
      id: 'mixed',
      name: 'Mixed fleet',
      members: [
        { name: 'native', description: 'lane work', prompt: 'hold the lane', provider: 'spawn' },
        { name: 'cli', description: 'one-shot work', prompt: 'run the external agent', provider: 'ext-cli' },
      ],
    }, 0)
    if (!saved.ok) throw new Error(saved.error.message)
    expect(await ctx.agentTeams.launchFleetFavorite(lead, 'mixed', true)).toMatchObject({ ok: true })

    // One call to each execution model: the lane child is continuable, the CLI-style
    // member is dispatched as a single delegation that settles with its result.
    expect(continuable).toHaveBeenCalledTimes(1)
    expect(rowOf(ctx, lead, 'native')).toMatchObject({ mode: 'lane', phase: 'active' })
    await vi.waitFor(() => {
      expect(rowOf(ctx, lead, 'cli')).toMatchObject({ mode: 'one-shot', phase: 'completed' })
    }, { timeout: 5_000 })
    expect(rowOf(ctx, lead, 'cli')?.result).toEqual({ stopReason: 'completed', output: content('cli answer') })
    expect(provider.dispositions).toHaveLength(1)
    // The Lead actually receives the one-shot result as a peer item, while the lane
    // member stays live and usable.
    const cliReport = await waitReceipt(ctx, lead, 'cli')
    const reportText = leadReceipts(lead).find(candidate => candidate.id === cliReport)!.text
    expect(reportText).toContain('Melody teammate "cli" settled with stop reason "completed"')
    expect(reportText).toContain('cli answer')

    // The settled one-shot is terminal and inert in the roster, while the lane
    // member keeps its mailbox: one member's shape never changes the other's.
    const statuses = Object.fromEntries(ctx.agentTeams.listMembers(lead).map(member => [member.name, member.status]))
    expect(statuses.cli).toBe('inactive')
    expect(await ctx.agentTeams.sendMessage(lead, {
      target: 'native', content: content('lane mail'), signal: SIGNAL,
    })).toMatchObject({ status: 'accepted' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'cli', content: content('too late'), signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
  }, 30_000)
})

describe('Team lane isolation', () => {
  it('starts a write-scoped teammate in its own worktree lane', async () => {
    const repo = repository()
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(gnkHome)
    const { ctx, lead, teamFiber } = await setup(['hang'], { gnkHome }, { cwd: repo })
    const base = git(repo, 'rev-parse', 'HEAD')

    const { member } = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'lane-worker',
      description: 'lane worker',
      prompt: content('do lane work'),
      context: 'fresh',
      provider: 'spawn',
      writeScopes: ['src', 'docs'],
      signal: SIGNAL,
    })

    const lane = (await ctx.agentTeams.listLanes(lead))[0]
    expect(lane).toMatchObject({
      lane: 'lane-worker',
      childSessionId: member.id,
      stage: 'ready',
      baseRevision: base,
      writeScopes: ['src', 'docs'],
    })
    expect((await ctx.sessionPersistence.stat(member.id))?.header.cwd).toBe(lane?.path)
    expect(existsSync(join(lane!.path, 'README.md'))).toBe(true)
    expect(durable(lead).members[0]).toMatchObject({ phase: 'active', writeScopes: ['src', 'docs'] })
    const live = ctx.agents.get(member.id)
    if (live !== undefined) {
      expect(ctx.agentTeams.lanePolicyFor(live)).toEqual({ kind: 'isolated', writeScopes: ['src', 'docs'] })
    }
    expect(ctx.agentTeams.lanePolicyFor(lead)).toEqual({ kind: 'shared' })
    ctx.agentTeams.interrupt(lead, 'lane-worker')
    await waitNoAgent(ctx, member.id)
    const checkpoint = await ctx.agentTeams.checkpointLane(lead, 'lane-worker', SIGNAL)
    expect(checkpoint.hash).toHaveLength(64)
    await ctx.agentTeams.discardLane(lead, 'lane-worker', SIGNAL)
    expect(existsSync(lane!.path)).toBe(false)
    expect((await ctx.agentTeams.listLanes(lead))[0]?.stage).toBe('discarded')
    await teamFiber.dispose()
  }, 20_000)

  it('refuses overlapping lane scopes and writable lanes outside a Git work tree', async () => {
    const outsideCwd = mkdtempSync(join(tmpdir(), 'gnk-team-no-repo-'))
    roots.push(outsideCwd)
    const repo = repository()
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(gnkHome)
    const { ctx, lead } = await setup(
      [textResponse('first lane'), textResponse('second lane')],
      { gnkHome },
      { cwd: repo },
    )
    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'first-lane',
      description: 'first lane',
      prompt: content('first'),
      context: 'fresh',
      provider: 'spawn',
      writeScopes: ['src'],
      signal: SIGNAL,
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'second-lane',
      description: 'second lane',
      prompt: content('second'),
      context: 'fresh',
      provider: 'spawn',
      writeScopes: ['src/nested'],
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_LANE_SCOPE_OVERLAP' })
    expect(durable(lead).members.map(member => member.name)).toEqual(['first-lane'])

    const outsideHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(outsideHome)
    const outside = await setup([textResponse('no repo lane')], { gnkHome: outsideHome }, { cwd: outsideCwd })
    await expect(outside.ctx.agentTeams.spawnTeammate(outside.lead, {
      name: 'no-repo-lane',
      description: 'no repo lane',
      prompt: content('no repo'),
      context: 'fresh',
      provider: 'spawn',
      writeScopes: ['src'],
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_LANE_NO_REPOSITORY' })
    expect(durable(outside.lead).members[0]).toMatchObject({ phase: 'failed' })
  }, 20_000)

  it('merges three heterogeneous lane presets serially onto one relative path', async () => {
    const repo = repository()
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(gnkHome)
    const lines = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}\n`).join('')
    writeFileSync(join(repo, 'notes.md'), lines)
    git(repo, 'add', 'notes.md')
    git(repo, 'commit', '-qm', 'notes')
    const { ctx, lead } = await setup(
      [textResponse('one'), textResponse('two'), textResponse('three')],
      { gnkHome },
      { cwd: repo },
    )
    ctx.provide('agentPresets', { mount: vi.fn(async () => {}), composedPreset: () => 'standard' } as never)
    const lanes = [
      { name: 'alpha', preset: 'standard', scope: 'one', line: 1 },
      { name: 'beta', preset: 'reviewing', scope: 'two', line: 7 },
      { name: 'gamma', preset: 'docs', scope: 'three', line: 14 },
    ] as const

    for (const lane of lanes) {
      const { member } = await ctx.agentTeams.spawnTeammate(lead, {
        name: lane.name,
        description: `${lane.name} lane`,
        prompt: content(`work in ${lane.name}`),
        context: 'fresh',
        provider: 'spawn',
        agentPreset: lane.preset,
        writeScopes: [lane.scope],
        signal: SIGNAL,
      })
      await waitNoAgent(ctx, member.id)
      const record = (await ctx.agentTeams.listLanes(lead)).find(candidate => candidate.lane === lane.name)!
      const stored = await ctx.sessionPersistence.open(member.id, 'read')
      try {
        expect(stored.header.agentPreset).toBe(lane.preset)
        expect(stored.header.cwd).toBe(record.path)
      } finally {
        await stored.close()
      }
      writeFileSync(join(record.path, 'notes.md'), lines.split('\n').map((text, index) => (
        index + 1 === lane.line ? `${lane.name} changed this line` : text
      )).join('\n'))
    }

    await expect(ctx.agentTeams.checkpointLane(lead, 'missing', SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_LANE_NOT_FOUND' })
    expect(ctx.agentTeams.laneQueueHaltReason(lead)).toBeUndefined()
    expect(() => { ctx.agentTeams.resumeLaneQueue(lead) }).not.toThrow()

    let primaryHead = git(repo, 'rev-parse', 'HEAD')
    for (const lane of lanes) {
      const checkpoint = await ctx.agentTeams.checkpointLane(lead, lane.name, SIGNAL)
      const merged = await ctx.agentTeams.integrateLane(lead, {
        lane: lane.name,
        expectedPrimaryHead: primaryHead,
        patchHash: checkpoint.hash,
        gateCommands: [],
        commitMessage: `merge ${lane.name}`,
        signal: SIGNAL,
      })
      primaryHead = merged.primaryHead
    }

    const mergedText = readFileSync(join(repo, 'notes.md'), 'utf8').split('\n')
    for (const lane of lanes) expect(mergedText[lane.line - 1]).toBe(`${lane.name} changed this line`)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect((await ctx.agentTeams.listLanes(lead)).map(record => record.stage)).toEqual([
      'merged', 'merged', 'merged',
    ])
    for (const lane of lanes) {
      expect(existsSync(join(realpathSync(gnkHome), 'worktrees', 'lead', lane.name))).toBe(false)
    }
  }, 40_000)

  it('checkpoints but keeps unmerged lane work when the Team service disposes', async () => {
    const repo = repository()
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(gnkHome)
    const { ctx, lead, teamFiber } = await setup([textResponse('dispose lane')], { gnkHome }, { cwd: repo })
    const { member } = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'survivor',
      description: 'surviving lane',
      prompt: content('edit the lane'),
      context: 'fresh',
      provider: 'spawn',
      writeScopes: ['src'],
      signal: SIGNAL,
    })
    const lane = (await ctx.agentTeams.listLanes(lead))[0]!
    await waitNoAgent(ctx, member.id)
    writeFileSync(join(lane.path, 'kept.txt'), 'unmerged\n')

    await teamFiber.dispose()

    const record = JSON.parse(readFileSync(join(gnkHome, 'lanes', 'lead', 'survivor', 'lane.json'), 'utf8')) as {
      readonly stage: string
      readonly checkpoint?: { readonly hash: string; readonly path: string }
    }
    expect(record.stage).toBe('ready')
    expect(record.checkpoint?.hash).toHaveLength(64)
    expect(existsSync(lane.path)).toBe(true)
    expect(readFileSync(record.checkpoint!.path, 'utf8')).toContain('kept.txt')
  }, 20_000)

  it('stops a teammate at its next step boundary after its token budget', async () => {
    const { ctx, lead, adapter } = await setup(
      [toolCallResponse('pause-call', 'pause', {}), textResponse('must not run')],
      {},
      {},
      true,
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'pause',
      description: 'Pause one step.',
      parameters: {},
      async execute() {
        return [{ type: 'text' as const, text: 'paused' }]
      },
    }))
    const { member } = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'budgeted',
      description: 'budgeted worker',
      prompt: content('spend one step'),
      context: 'fresh',
      provider: 'spawn',
      maxTokens: 10,
      signal: SIGNAL,
    })

    await vi.waitFor(() => {
      expect(ctx.agentTeams.listMembers(lead)[1]?.diagnostics).toContain('member token budget exceeded')
    }, { timeout: 5_000 })
    await waitNoAgent(ctx, member.id)
    // The Lead records the child's settlement in its own turn; the child itself
    // must have received exactly its initial step and no post-budget step.
    expect(adapter.requests.filter(request => request.messages.some(message => message.source?.kind === 'user')))
      .toHaveLength(1)
    expect(durable(lead).members[0]).toMatchObject({ phase: 'active', maxTokens: 10 })
  }, 20_000)

  it('admits a repository fleet only once for the Lead and its exact bytes', async () => {
    const repo = repository()
    mkdirSync(join(repo, '.gnk'))
    writeFileSync(join(repo, '.gnk', 'fleet.json'), JSON.stringify({
      version: 1,
      fleet: { members: [{ name: 'lane', description: 'lane', prompt: 'work' }] },
    }))
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(gnkHome)
    const { ctx, lead } = await setup([], { gnkHome }, { cwd: repo })

    const snapshot = await ctx.agentTeams.readRepoFleet(lead, SIGNAL)
    expect(snapshot.approved).toBe(false)
    expect(snapshot.config.fleet.members[0]?.name).toBe('lane')
    expect((await ctx.agentTeams.approveRepoFleet(lead, SIGNAL)).approved).toBe(true)
    expect((await ctx.agentTeams.admitRepoFleet(lead, SIGNAL)).bytesHash).toBe(snapshot.bytesHash)
    await expect(ctx.agentTeams.admitRepoFleet(lead, SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_FLEET_CONFIG_UNAPPROVED' })

    const withoutCwd = await setup([], { gnkHome })
    await expect(withoutCwd.ctx.agentTeams.readRepoFleet(withoutCwd.lead, SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_FLEET_CONFIG_MISSING' })
  })

  it('finishes disposal when a lane checkpoint refuses a moved HEAD', async () => {
    const repo = repository()
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-team-lane-home-'))
    roots.push(gnkHome)
    const { ctx, lead, teamFiber } = await setup([textResponse('moved lane')], { gnkHome }, { cwd: repo })
    const { member } = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'moved',
      description: 'moved lane',
      prompt: content('move the lane'),
      context: 'fresh',
      provider: 'spawn',
      writeScopes: ['src'],
      signal: SIGNAL,
    })
    const lane = (await ctx.agentTeams.listLanes(lead))[0]!
    await waitNoAgent(ctx, member.id)
    writeFileSync(join(lane.path, 'moved.txt'), 'member commit\n')
    git(lane.path, 'add', 'moved.txt')
    git(lane.path, 'commit', '-qm', 'bypass guard')

    await expect(teamFiber.dispose()).resolves.toBeUndefined()

    const record = JSON.parse(readFileSync(join(gnkHome, 'lanes', 'lead', 'moved', 'lane.json'), 'utf8')) as {
      readonly stage: string
    }
    expect(record.stage).toBe('quarantined')
  }, 20_000)

  it('records a durable read-only policy without creating a lane', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const { member } = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'reader',
      description: 'reader',
      prompt: content('inspect only'),
      context: 'fresh',
      provider: 'spawn',
      readOnly: true,
      signal: SIGNAL,
    })
    const plain = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'plain',
      description: 'plain',
      prompt: content('share the checkout'),
      context: 'fresh',
      provider: 'spawn',
      agentOptions: { model: 'lane-model' },
      signal: SIGNAL,
    })

    expect(durable(lead).members[0]).toMatchObject({ phase: 'active', readOnly: true })
    expect(durable(lead).members[1]).toMatchObject({ phase: 'active' })
    expect(ctx.agentTeams.listMembers(lead)[2]).toMatchObject({ name: 'plain', model: 'lane-model' })
    expect(await ctx.agentTeams.listLanes(lead)).toEqual([])
    const reader = ctx.agents.get(member.id)
    if (reader !== undefined) {
      expect(ctx.agentTeams.lanePolicyFor(reader)).toEqual({ kind: 'read-only' })
      await expect(ctx.agentTeams.checkpointLane(reader, 'missing', SIGNAL))
        .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
      await expect(ctx.agentTeams.discardLane(reader, 'missing', SIGNAL))
        .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
      await expect(ctx.agentTeams.integrateLane(reader, {
        lane: 'missing',
        expectedPrimaryHead: 'head',
        patchHash: 'hash',
        gateCommands: [],
        commitMessage: 'merge',
        signal: SIGNAL,
      })).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
      expect(() => { ctx.agentTeams.resumeLaneQueue(reader) }).toThrow('only the Team Lead')
      expect(ctx.agentTeams.laneQueueHaltReason(reader)).toBeUndefined()
      await expect(ctx.agentTeams.readRepoFleet(reader, SIGNAL))
        .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
      await expect(ctx.agentTeams.saveFleetFavorite(reader, {
        id: 'x', name: 'X', members: [{ name: 'x', description: 'x', prompt: 'x', provider: 'spawn' }],
      }, 0)).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
      await expect(ctx.agentTeams.deleteFleetFavorite(reader, 'x', 0))
        .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
      await expect(ctx.agentTeams.launchFleetFavorite(reader, 'x', true))
        .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    }
    const shared = ctx.agents.get(plain.member.id)
    if (shared !== undefined) expect(ctx.agentTeams.lanePolicyFor(shared)).toEqual({ kind: 'shared' })
    ctx.agentTeams.interrupt(lead, 'reader')
    ctx.agentTeams.interrupt(lead, 'plain')
    await waitNoAgent(ctx, member.id)
    await waitNoAgent(ctx, plain.member.id)
  }, 10_000)

  it('contains a scheduled recovery failure as a warning', async () => {
    const { ctx, lead } = await setup([])
    const internals = teamInternals(ctx)
    vi.spyOn(internals, 'recoverFor').mockRejectedValue(new Error('recovery failed'))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    internals.scheduleRecovery(lead)

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('recovery failed'))
    })
  })

  it('contains a lane recovery failure as a warning', async () => {
    const { ctx, lead } = await setup([])
    const recover = vi.spyOn(LaneLifecycleManager.prototype, 'recover').mockRejectedValue(new Error('lane recovery failed'))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    teamInternals(ctx).scheduleRecovery(lead)

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('lane recovery failed'))
    })
    recover.mockRestore()
  })

  it('reports a disposal checkpoint failure after releasing members', async () => {
    const { ctx } = await setup([])
    const internals = teamInternals(ctx)
    vi.spyOn(internals.roster, 'checkpointLanes').mockRejectedValue(new Error('checkpoint refused'))

    await expect(internals.disposeRuntime()).rejects.toThrow('Agent Teams runtime disposal failed')
  })

  it('fails closed at a step when the token projection disappears after admission', async () => {
    const { ctx, lead } = await setup(['hang'], {}, {}, true)
    const { member } = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'vanishing-meter',
      description: 'metered lane',
      prompt: content('wait'),
      context: 'fresh',
      provider: 'spawn',
      maxTokens: 1_000,
      signal: SIGNAL,
    })
    const live = ctx.agents.get(member.id)!
    const stateOf = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
    const spy = vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => (
      key === 'tokenUsage' ? undefined : stateOf(session, key)
    ))

    expect(teamInternals(ctx).roster.enforceTokenBudget(live)).toBe(true)
    expect(ctx.agentTeams.listMembers(lead)[1]?.diagnostics).toContain('member token budget exceeded')
    spy.mockRestore()
    ctx.agentTeams.interrupt(lead, 'vanishing-meter')
    await waitNoAgent(ctx, member.id)
  }, 10_000)

  it('rejects invalid lane and budget fields before creating a roster entry', async () => {
    const { ctx, lead } = await setup([])
    const base = {
      name: 'invalid',
      description: 'invalid request',
      prompt: content('never starts'),
      context: 'fresh' as const,
      provider: 'spawn',
      signal: SIGNAL,
    }

    await expect(ctx.agentTeams.spawnTeammate(lead, { ...base, maxTokens: 0 }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.spawnTeammate(lead, { ...base, maxTokens: 5 }))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_METER_UNAVAILABLE' })
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      ...base, writeScopes: ['src'], cwd: '/tmp/lane',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_LANE_POLICY' })
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      ...base, writeScopes: ['src'], readOnly: true,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_LANE_POLICY' })
    expect(durable(lead).members).toEqual([])
  })
})

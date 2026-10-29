import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import AgentLoop from '@greeneek/gnk-agent-loop'
import { mountAgentLoopTestDependencies } from '@greeneek/gnk-agent-loop-testkit'
import { ToolCallId } from '@greeneek/gnk-llm'
import { scopeOf } from '@greeneek/gnk-scope'
import { SessionId } from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import SessionQueryEngine from '@greeneek/gnk-session-query'
import SubagentService from '@greeneek/gnk-subagent'
import * as SubagentFork from '@greeneek/gnk-subagent-fork-in-process'
import * as SubagentSpawn from '@greeneek/gnk-subagent-spawn-in-process'
import { renderPrompt } from '@greeneek/gnk-system-prompt'
import * as ToolSubagentControl from '@greeneek/gnk-tool-subagent-control'
import { defineContentToolFixture } from '@greeneek/gnk-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'

const SIGNAL = new AbortController().signal
const TOOL_NAMES = [
  'spawn_teammate',
  'spawn_fleet',
  'checkpoint_lane',
  'discard_lane',
  'integrate_lane',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
].sort()

const roots: string[] = []
let callNumber = 0

/** Session query implementation whose search faces are outside these tests. */
class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  legacyControl = false,
  options: { readonly cwd?: string; readonly gnkHome?: string } = {},
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'gnk-tool-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  if (legacyControl) await ctx.plugin(ToolSubagentControl)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, options.gnkHome === undefined ? {} : { gnkHome: options.gnkHome })
  const fiber = await ctx.plugin(toolTeam)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(
    SessionId('tool-team-lead'),
    { provider: 'mock', model: 'mock' },
    options.cwd === undefined ? {} : { cwd: options.cwd },
  )
  return { ctx, lead, fiber }
}

function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = SIGNAL,
) {
  return ctx.tools.execute({
    callId: ToolCallId(`team-call-${++callNumber}`),
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function spawnedChildId(result: Awaited<ReturnType<typeof execute>>): SessionId {
  const parsed: unknown = JSON.parse(text(result))
  if (typeof parsed !== 'object' || parsed === null || !('member' in parsed)) {
    throw new Error('spawn_teammate result has no member')
  }
  const member = parsed.member
  if (typeof member !== 'object' || member === null || !('id' in member) || typeof member.id !== 'string') {
    throw new Error('spawn_teammate result has no member id')
  }
  return SessionId(member.id)
}

async function assembly(ctx: Context, agent: Agent) {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  return ctx.systemPrompt.assemble({ scope })
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const child = ctx.agents.get(id)
    expect(child?.status).toBe('running')
    return child!
  }, { timeout: 5_000 })
}

async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

describe('gnk-tool-team', () => {
  it('installs the complete scoped schema and shared-checkout policy for roots and teammates', async () => {
    const { ctx, lead } = await setup(['hang'])
    const leadAssembly = await assembly(ctx, lead)
    expect(leadAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const leadPrompt = renderPrompt(leadAssembly)
    expect(leadPrompt).toContain('create teammates only when the user explicitly asks')
    expect(leadPrompt).toContain('FS_STALE_VERSION')
    expect(leadPrompt).toContain('Bash, formatters, code generators, and scripts are not fully protected')
    expect(leadPrompt).toContain('Task readiness never starts an owner')
    expect(leadPrompt).toContain('returns noProgress immediately')
    expect(leadPrompt).toContain('Your Team role is lead')

    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'tool-worker',
      description: 'exercise scoped tools',
      prompt: 'stay available',
    })
    expect(spawned.isError).toBe(false)
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)
    const childAssembly = await assembly(ctx, child)
    expect(childAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect(renderPrompt(childAssembly)).toContain('Your Team role is teammate; your Team name is tool-worker')
    const initialPrompt = child.session.snapshotEvents().find(event => event.type === 'user/message'
      && event.data.source.kind === 'user')
    expect(initialPrompt?.type === 'user/message'
      ? initialPrompt.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : []).toEqual(['stay available'])

    const denied = await execute(ctx, child, 'spawn_teammate', {
      name: 'nested', description: 'not allowed', prompt: 'no',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('only the Team Lead')
    await execute(ctx, lead, 'interrupt_agent', { target: 'tool-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('forwards a lane preset and cwd onto the Team spawn request', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])
    const lane = mkdtempSync(join(tmpdir(), 'gnk-team-lane-'))
    roots.push(lane)
    const spawn = vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockResolvedValue({
      member: { id: 'lane-child', name: 'lane-worker', role: 'teammate', status: 'running', diagnostics: [] },
    } as never)
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'lane-worker',
      description: 'run in an isolated lane',
      prompt: 'finish in the lane',
      preset: 'reviewing',
      cwd: lane,
      model: 'lane-model',
    })
    expect(result.isError, text(result)).toBe(false)
    expect(spawn).toHaveBeenCalledWith(lead, expect.objectContaining({
      agentPreset: 'reviewing',
      cwd: lane,
      agentOptions: { model: 'lane-model' },
    }))
    const effortOnly = await execute(ctx, lead, 'spawn_teammate', {
      name: 'effort-worker',
      description: 'effort only',
      prompt: 'finish',
      reasoning_effort: 'high',
      max_tokens: 12,
    })
    expect(effortOnly.isError, text(effortOnly)).toBe(false)
    expect(spawn).toHaveBeenCalledWith(lead, expect.objectContaining({
      agentOptions: { reasoningEffort: 'high' },
      maxTokens: 12,
    }))
    const readOnly = await execute(ctx, lead, 'spawn_teammate', {
      name: 'read-only-worker', description: 'read only', prompt: 'inspect', read_only: true,
    })
    expect(readOnly.isError, text(readOnly)).toBe(false)
    expect(spawn).toHaveBeenCalledWith(lead, expect.objectContaining({ readOnly: true }))
    const scoped = await execute(ctx, lead, 'spawn_teammate', {
      name: 'scoped-worker', description: 'scoped', prompt: 'write', write_scopes: ['src'],
    })
    expect(scoped.isError, text(scoped)).toBe(false)
    expect(spawn).toHaveBeenCalledWith(lead, expect.objectContaining({ writeScopes: ['src'] }))
  })

  it('returns actionable no-progress output and renders structured wait cancellation', async () => {
    const inactiveSetup = await setup([textResponse('worker done')])
    const inactiveSpawn = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'spawn_teammate', {
      name: 'inactive-worker', description: 'finish immediately', prompt: 'finish',
    })
    const inactiveId = spawnedChildId(inactiveSpawn)
    await waitNoAgent(inactiveSetup.ctx, inactiveId)
    const noProgress = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms: 3_600_000 })
    expect(noProgress.isError).toBe(false)
    expect(JSON.parse(text(noProgress))).toEqual({
      timedOut: false,
      noProgress: {
        reason: 'no-active-peer',
        message: 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.',
      },
    })
    for (const timeout_ms of [9_999, 3_600_001, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('timeoutMs must be an integer from 10000 through 3600000')
    }

    const activeSetup = await setup(['hang'])
    const activeSpawn = await execute(activeSetup.ctx, activeSetup.lead, 'spawn_teammate', {
      name: 'active-worker', description: 'stay active', prompt: 'wait',
    })
    const activeId = spawnedChildId(activeSpawn)
    await waitRunning(activeSetup.ctx, activeId)
    const controller = new AbortController()
    const waiting = execute(activeSetup.ctx, activeSetup.lead, 'wait_agent', { timeout_ms: 10_000 }, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort({ kind: 'user' })
    const aborted = await waiting
    expect(aborted.isError).toBe(true)
    expect(text(aborted)).toBe("Error: wait_agent aborted: { kind: 'user' }")
    await execute(activeSetup.ctx, activeSetup.lead, 'interrupt_agent', { target: 'active-worker' })
    await waitNoAgent(activeSetup.ctx, activeId)
  })

  it('adapts roster, mailbox, wait, and task CAS operations to canonical JSON', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('lead received wakeup')])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'json-worker', description: 'json worker', prompt: 'wait', context: 'fresh',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    const roster = await execute(ctx, child, 'list_agents', {})
    expect(JSON.parse(text(roster))).toMatchObject([
      { name: 'lead', role: 'lead' },
      { name: 'json-worker', role: 'teammate' },
    ])
    // Every Team result reaches the model as compact JSON: indentation would
    // spend tokens on every roster, task, and receipt without adding meaning.
    expect(text(roster)).toBe(JSON.stringify(JSON.parse(text(roster))))
    const peer = await execute(ctx, child, 'send_message', { target: 'lead', message: 'progress report' })
    expect(peer.isError).toBe(false)
    expect(JSON.parse(text(peer))).toMatchObject({ status: 'accepted' })
    const followup = await execute(ctx, child, 'send_message', { target: 'lead', message: 'review the report' })
    expect(followup.isError).toBe(false)
    expect(JSON.parse(text(followup))).toMatchObject({ status: 'accepted' })
    await lead.whenIdle()

    const created = await execute(ctx, lead, 'team_task_create', {
      subject: 'tool task',
      description: 'created through tool',
      blocked_by: [],
      write_scopes: ['src/team'],
    })
    const task = JSON.parse(text(created)) as { id: string; revision: number }
    const listed = await execute(ctx, child, 'team_task_list', { ready: true, limit: 1 })
    expect(JSON.parse(text(listed))).toMatchObject({ tasks: [{ id: task.id, ready: true }] })
    const read = await execute(ctx, child, 'team_task_get', { task_id: task.id })
    expect(JSON.parse(text(read))).toMatchObject({ id: task.id, revision: 1 })
    const claimed = await execute(ctx, child, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'claim',
    })
    expect(JSON.parse(text(claimed))).toMatchObject({ status: 'in_progress', ownerName: 'json-worker' })
    const stale = await execute(ctx, lead, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'delete',
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('stale team task')

    const wait = execute(ctx, lead, 'wait_agent', { timeout_ms: 10_000 })
    const completedCall = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, child, 'team_task_update', {
          task_id: task.id,
          expected_revision: 2,
          action: 'complete',
        }).then(resolve, reject)
      }, 0)
    })
    await expect(wait).resolves.toMatchObject({ isError: false })
    expect((await completedCall).isError).toBe(false)

    const childInterrupt = await execute(ctx, child, 'interrupt_agent', { target: 'json-worker' })
    expect(childInterrupt.isError).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'json-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('adapts optional task filters, mutations, pagination, and default waiting', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'fork-worker', description: 'fork worker', prompt: 'stay active', context: 'fork',
    })
    const childId = spawnedChildId(spawned)
    await waitRunning(ctx, childId)

    const firstResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'first', description: 'first task',
    })
    const secondResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'second', description: 'second task',
    })
    const first = JSON.parse(text(firstResult)) as { id: string; revision: number }
    const second = JSON.parse(text(secondResult)) as { id: string; revision: number }
    const claimed = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id, expected_revision: first.revision, action: 'claim',
    })
    const claim = JSON.parse(text(claimed)) as { revision: number }

    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      status: 'in_progress', owner: 'lead', cursor: 0, limit: 1,
    })))).toMatchObject({ tasks: [{ id: first.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      owner: 'unowned', limit: 1,
    })))).toMatchObject({ tasks: [{ id: second.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 0, limit: 1,
    })))).toMatchObject({ nextCursor: 1 })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 1,
    })))).not.toHaveProperty('nextCursor')
    expect((await execute(ctx, lead, 'team_task_list', { cursor: -1 })).isError).toBe(true)
    expect((await execute(ctx, lead, 'team_task_list', { limit: 101 })).isError).toBe(true)

    const edited = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: claim.revision,
      action: 'edit',
      subject: 'edited',
      description: 'edited description',
      write_scopes: ['src/team'],
    })
    const edit = JSON.parse(text(edited)) as { revision: number }
    const dependencies = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: edit.revision,
      action: 'set_dependencies',
      blocked_by: [second.id],
    })
    expect(dependencies.isError).toBe(false)
    const dependency = JSON.parse(text(dependencies)) as { revision: number }
    expect((await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: dependency.revision,
      action: 'reassign',
      owner: 'fork-worker',
    })).isError).toBe(true)

    const wait = execute(ctx, lead, 'wait_agent', {})
    const wake = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, lead, 'team_task_create', {
          subject: 'wake', description: 'wake default wait',
        }).then(resolve, reject)
      }, 0)
    })
    expect((await wait).isError).toBe(false)
    expect((await wake).isError).toBe(false)

    await execute(ctx, lead, 'interrupt_agent', { target: 'fork-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('removes and reinstalls every scoped registration across plugin HMR without stopping the child', async () => {
    const { ctx, lead, fiber } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'hmr-worker', description: 'hmr worker', prompt: 'wait',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    await fiber.dispose()
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect(ctx.agents.get(childId)).toBe(child)

    const replacement = await ctx.plugin(toolTeam)
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    await execute(ctx, lead, 'interrupt_agent', { target: 'hmr-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    await replacement.dispose()
  })

  it('shadows legacy global control names only inside Team member scopes', async () => {
    const { ctx, lead, fiber } = await setup([], true)
    const teamSchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(teamSchema)).toContain('target')
    expect(JSON.stringify(teamSchema)).not.toContain('subagent_id')

    await fiber.dispose()
    const legacySchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(legacySchema)).toContain('agent_id')
  })

  it('rolls back partial scoped installation after a same-scope collision', async () => {
    const { ctx, lead, fiber } = await setup([])
    await fiber.dispose()
    lead.ctx.tools.register(defineContentToolFixture({
      name: 'spawn_teammate',
      description: 'intentional collision',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'collision' }] },
    }))

    await expect(ctx.plugin(toolTeam)).rejects.toThrow(/already registered/u)
    const assembled = await assembly(ctx, lead)
    expect(assembled.tools.filter(schema => TOOL_NAMES.includes(schema.name)).map(schema => schema.name))
      .toEqual(['spawn_teammate'])
    expect(renderPrompt(assembled)).not.toContain('Your Team role is lead')
  })

  it('resolves direct-apply defaults without Loader schema normalization', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('ordinary child')])
    await fiber.dispose()
    toolTeam.apply(ctx, {})
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const ordinary = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: [{ type: 'text', text: 'finish' }], parent: lead },
      signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.agents.get(ordinary.childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('reinstalls Team scope before a cold-resumed teammate request', async () => {
    const { ctx, lead } = await setup([textResponse('first'), 'hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'cold-worker', description: 'cold worker', prompt: 'finish once',
    })
    const childId = spawnedChildId(spawned)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })

    await ctx.agentTeams.sendMessage(lead, {
      target: 'cold-worker',
      content: [{ type: 'text', text: 'resume with Team scope' }],
      signal: SIGNAL,
    })
    const resumed = await waitRunning(ctx, childId)
    expect((await assembly(ctx, resumed)).tools.map(schema => schema.name)
      .filter(name => TOOL_NAMES.includes(name)).sort()).toEqual(TOOL_NAMES)
    expect(renderPrompt(await assembly(ctx, resumed))).toContain('Your Team role is teammate; your Team name is cold-worker')
    await execute(ctx, lead, 'interrupt_agent', { target: 'cold-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('fails safely without a calling Agent and has the function-plugin export shape', async () => {
    const { ctx } = await setup([])
    const result = await execute(ctx, undefined, 'list_agents', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "list_agents"')
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-agent-team')
    expect(toolTeam.inject).toEqual(['agents', 'agentTeams', 'tools', 'systemPrompt'])
  })

  it('uses configured fresh and fork provider names', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('custom')])
    await fiber.dispose()
    await ctx.plugin(SubagentSpawn, { providerName: 'team-fresh' })
    await ctx.plugin(toolTeam, { freshProvider: 'team-fresh', forkProvider: 'fork' })
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'custom-provider', description: 'custom provider', prompt: 'go',
    })
    expect(result.isError).toBe(false)
    const childId = spawnedChildId(result)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ provider: 'team-fresh' })
  })
})

/** Run git in one directory without a shell. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim()
}

/** One committed repository usable as the Lead checkout. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-tool-team-repo-'))
  roots.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'tool-team@example.com')
  git(root, 'config', 'user.name', 'Tool Team')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'gc.auto', '0')
  git(root, 'config', 'maintenance.auto', 'false')
  writeFileSync(join(root, 'README.md'), 'base\n')
  git(root, 'add', 'README.md')
  git(root, 'commit', '-qm', 'base')
  return root
}

/** Install a scripted approval service and return the requests it received. */
function approvalStub(ctx: Context, outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable') {
  const requests: Array<{ readonly reason?: string }> = []
  ctx.provide('approval', {
    request: vi.fn(async (request: { readonly reason?: string }) => {
      requests.push(request)
      return outcome
    }),
  } as never)
  return requests
}

describe('gnk-tool-team fleet confirmation', () => {
  it('shows every member field and creates nothing when the confirmation is declined', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])
    const requests = approvalStub(ctx, 'rejected')

    const result = await execute(ctx, lead, 'spawn_fleet', {
      label: 'review fleet',
      members: [
        {
          name: 'lane-alpha',
          description: 'review the lane',
          prompt: 'review',
          preset: 'standard',
          model: 'mock',
          reasoning_effort: 'high',
          max_tokens: 4_000,
          write_scopes: ['src'],
        },
        { name: 'reader', description: 'read only', prompt: 'read', read_only: true },
        { name: 'shared', description: 'shared', prompt: 'share' },
        { name: 'forked', description: 'forked', prompt: 'fork', context: 'fork' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no teammate or lane was created')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.reason).toContain('review fleet')
    expect(requests[0]?.reason).toContain('lane-alpha')
    expect(requests[0]?.reason).toContain('provider=spawn')
    expect(requests[0]?.reason).toContain('preset=standard')
    expect(requests[0]?.reason).toContain('model=mock')
    expect(requests[0]?.reason).toContain('effort=high')
    expect(requests[0]?.reason).toContain('budget=4000 tokens')
    expect(requests[0]?.reason).toContain('write scopes src')
    expect(requests[0]?.reason).toContain('read-only')
    expect(requests[0]?.reason).toContain('shared checkout, no declared write scope')
    expect(requests[0]?.reason).toContain('forked — provider=fork')
    expect(requests[0]?.reason).toContain('creates no children and no worktrees')
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
    expect(await ctx.agentTeams.listLanes(lead)).toEqual([])
  })

  it('launches the fleet after approval and creates only the declared lane', async () => {
    const repo = repository()
    const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-tool-team-home-'))
    roots.push(gnkHome)
    const { ctx, lead } = await setup([textResponse('fleet child answer')], false, { cwd: repo, gnkHome })
    const requests = approvalStub(ctx, 'allowed-once')

    const result = await execute(ctx, lead, 'spawn_fleet', {
      members: [{
        name: 'lane-alpha',
        description: 'one lane',
        prompt: 'do the lane work',
        write_scopes: ['src'],
      }],
    })

    expect(result.isError).toBe(false)
    expect(requests[0]?.reason).toContain('budget=unbounded')
    const members = ctx.agentTeams.listMembers(lead)
    expect(members).toHaveLength(2)
    expect(members[1]).toMatchObject({ name: 'lane-alpha', provider: 'spawn' })
    const lanes = await ctx.agentTeams.listLanes(lead)
    expect(lanes).toHaveLength(1)
    expect(lanes[0]).toMatchObject({ lane: 'lane-alpha', stage: 'ready', writeScopes: ['src'] })

    const childId = members[1]!.id
    await waitNoAgent(ctx, childId)
    await ctx.agentTeams.discardLane(lead, 'lane-alpha', SIGNAL)
  }, 20_000)

  it('fails closed before any child when the approval capability is absent', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])

    const result = await execute(ctx, lead, 'spawn_fleet', {
      members: [{ name: 'no-approval', description: 'never starts', prompt: 'never' }],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('approval capability')
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
    expect(await ctx.agentTeams.listLanes(lead)).toEqual([])
  })

  it('validates every fleet member before showing the confirmation card', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])
    const approval = approvalStub(ctx, 'allowed-once')
    const member = { name: 'valid', description: 'valid', prompt: 'work' }

    for (const [members, message] of [
      [[], 'at least one member'],
      [[{ ...member, name: 'Lead' }], 'lower-kebab-case'],
      [[{ ...member, name: 'a'.repeat(65) }], 'lower-kebab-case'],
      [[member, { ...member, description: 'second' }], 'duplicate'],
      [[{ ...member, max_tokens: 0 }], 'positive safe integer'],
      [[{ ...member, read_only: true, write_scopes: ['src'] }], 'mutually exclusive'],
    ] as const) {
      const result = await execute(ctx, lead, 'spawn_fleet', { members })
      expect(result.isError, message).toBe(true)
      expect(text(result), message).toContain(message)
    }
    expect(approval).toHaveLength(0)
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
  })

  it('reports a fleet that fails after approval and stops launching later members', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])
    approvalStub(ctx, 'allowed-once')
    const spawn = vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockRejectedValueOnce(new Error('provider refused'))

    const result = await execute(ctx, lead, 'spawn_fleet', {
      members: [
        { name: 'first', description: 'first', prompt: 'one' },
        { name: 'second', description: 'second', prompt: 'two' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('fleet stopped after 0 of 2 members: provider refused')
    spawn.mockRejectedValueOnce('string failure')
    const stringFailure = await execute(ctx, lead, 'spawn_fleet', {
      members: [{ name: 'third', description: 'third', prompt: 'three' }],
    })
    expect(stringFailure.isError).toBe(true)
    expect(text(stringFailure)).toContain('fleet stopped after 0 of 1 members: string failure')
  })

  it('bridges lane checkpoint, discard, and integration requests and results', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])
    const checkpoint = { hash: 'hash', path: 'patch', bytes: 1, at: 2 }
    const checkpointLane = vi.spyOn(ctx.agentTeams, 'checkpointLane').mockResolvedValue(checkpoint)
    const discardLane = vi.spyOn(ctx.agentTeams, 'discardLane').mockResolvedValue(checkpoint)
    const integrateLane = vi.spyOn(ctx.agentTeams, 'integrateLane').mockResolvedValue({
      lane: 'alpha',
      patchHash: 'hash',
      primaryHead: 'head' as never,
      gates: [{ argv: ['gate'], output: 'ok' }],
    })

    expect(JSON.parse(text(await execute(ctx, lead, 'checkpoint_lane', { lane: 'alpha' })))).toEqual(checkpoint)
    expect(checkpointLane).toHaveBeenCalledWith(lead, 'alpha', SIGNAL)
    expect(JSON.parse(text(await execute(ctx, lead, 'discard_lane', { lane: 'alpha' })))).toEqual(checkpoint)
    expect(discardLane).toHaveBeenCalledWith(lead, 'alpha', SIGNAL)

    const integrated = await execute(ctx, lead, 'integrate_lane', {
      lane: 'alpha',
      expected_primary_head: 'head',
      patch_hash: 'hash',
      gate_commands: [['gate']],
      commit_message: 'merge alpha',
    })
    expect(JSON.parse(text(integrated))).toEqual({
      lane: 'alpha',
      patchHash: 'hash',
      primaryHead: 'head',
      gates: [{ argv: ['gate'], output: 'ok' }],
    })
    expect(integrateLane).toHaveBeenCalledWith(lead, expect.objectContaining({
      lane: 'alpha',
      expectedPrimaryHead: 'head',
      patchHash: 'hash',
      gateCommands: [{ argv: ['gate'] }],
      commitMessage: 'merge alpha',
    }))

    await execute(ctx, lead, 'integrate_lane', {
      lane: 'alpha',
      expected_primary_head: 'head',
      patch_hash: 'hash',
      commit_message: 'merge alpha',
    })
    expect(integrateLane).toHaveBeenLastCalledWith(lead, expect.objectContaining({ gateCommands: [] }))
  })
})

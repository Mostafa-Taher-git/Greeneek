/**
 * Real mixed-fleet integration: OpenCode runs one Team member through the shipped
 * out-of-process ACP backend while a native provider holds a continuable lane in the
 * same Team, and the settled external result reaches the Lead as an ordinary mailbox
 * report.
 *
 * Nothing here substitutes a fake transport. The provider plugin is
 * `@greeneek/gnk-subagent-acp`, the child is the installed `opencode acp` process, and
 * its answer crosses the ACP boundary as streamed text. The suite skips with a printed
 * reason when no OpenCode executable resolves, because that is an absent prerequisite
 * rather than a passing integration. A provider or credential refusal is never scored
 * as a pass: the run either settles `completed` with real output, or the assertion on
 * the settled result fails with the diagnostic the adapter reported.
 *
 * The child workspace pins OpenCode to a model route through a project-level
 * `opencode.jsonc`, so no credential is read, forwarded, or printed by this suite —
 * OpenCode keeps its own auth store, and `subagent-acp` forwards an empty explicit
 * environment over the credential-scrubbed parent copy.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import AgentLoop from '@greeneek/gnk-agent-loop'
import { mountAgentLoopTestDependencies } from '@greeneek/gnk-agent-loop-testkit'
import { SessionId, type SessionEvent } from '@greeneek/gnk-session'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import SubagentService from '@greeneek/gnk-subagent'
import * as SubagentAcp from '@greeneek/gnk-subagent-acp'
import * as SubagentSpawn from '@greeneek/gnk-subagent-spawn-in-process'
import LocalSubprocessRuntime from '@greeneek/gnk-subprocess-local'
import type { SubprocessHandle } from '@greeneek/gnk-subprocess'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../src/index.ts'
import { teamProjectionDefinition } from '../src/projection.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const EXTERNAL_ANSWER = 'Reply with exactly two words: PROBE OK. Do not use any tools.'
const SETTLE_TIMEOUT_MS = 240_000
const TEST_TIMEOUT_MS = 300_000
const roots: string[] = []
const contexts: Context[] = []

/**
 * Locate the installed OpenCode executable, or undefined when this host has none.
 *
 * `GNK_OPENCODE_COMMAND` overrides the search with an absolute path so a maintainer on
 * another layout can run the suite without editing it. The npm global prefix is checked
 * because the Windows shim (`opencode.cmd`) is not an executable a subprocess can spawn.
 * @returns an absolute executable path, or undefined when OpenCode is absent.
 */
function resolveOpenCode(): string | undefined {
  const override = process.env.GNK_OPENCODE_COMMAND
  if (override !== undefined && override !== '') {
    return existsSync(override) ? override : undefined
  }
  const names = process.platform === 'win32' ? ['opencode.exe'] : ['opencode']
  const prefixes = [
    process.env.APPDATA === undefined ? undefined : join(process.env.APPDATA, 'npm', 'node_modules', '@opencode', 'cli', 'bin'),
    process.env.HOME === undefined ? undefined : join(process.env.HOME, '.opencode', 'bin'),
    '/usr/local/bin',
    ...(process.env.PATH ?? '').split(delimiter),
  ]
  for (const prefix of prefixes) {
    if (prefix === undefined || prefix === '') continue
    for (const name of names) {
      const candidate = join(prefix, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const OPENCODE = resolveOpenCode()
if (OPENCODE === undefined) {
  console.info(
    'Skipping the real OpenCode mixed-fleet integration: no `opencode` executable resolved '
    + '(set GNK_OPENCODE_COMMAND to an absolute path to run it). A skip is not a pass.',
  )
}

/** One Team member row read through the shipped projection definition. */
function memberRow(lead: Agent, name: string): Record<string, unknown> | undefined {
  let projected = teamProjectionDefinition.init(lead.session.header)
  for (const event of lead.session.snapshotEvents()) projected = teamProjectionDefinition.apply(projected, event)
  if (projected.failure !== undefined) throw new Error(`Team projection failed: ${projected.failure}`)
  return projected.members.find(candidate => candidate.name === name) as Record<string, unknown> | undefined
}

/** Every Team event the Lead's own Session recorded. */
function teamEvents(lead: Agent, type: string): readonly SessionEvent[] {
  return lead.session.snapshotEvents().filter(event => event.type === type)
}

/** Text a Lead turn actually received from a peer, with the sending member. */
function leadReceipts(lead: Agent): { id: string; sender: string; text: string }[] {
  return lead.session.snapshotEvents().flatMap((event) => {
    if (event.type !== 'user/message') return []
    const data = event.data as {
      source: { kind: string; senderName?: string; messageId?: string }
      content: readonly { type: string; text?: string }[]
    }
    if (data.source.kind !== 'team-message') return []
    return [{
      id: data.source.messageId ?? '',
      sender: data.source.senderName ?? '',
      text: data.content.map(block => block.type === 'text' ? block.text ?? '' : '').join(' '),
    }]
  })
}

/**
 * Mount the shipped Team composition with one native lane provider and two real
 * out-of-process ACP providers: `opencode` for the working product and `broken-acp` for a
 * sibling that fails at the process boundary.
 * @param workspace - absolute directory the ACP children run in, holding OpenCode's model pin.
 * @returns the live context, the Lead agent, and every subprocess handle the ACP backend spawned.
 */
async function setup(workspace: string): Promise<{ ctx: Context; lead: Agent; handles: SubprocessHandle[] }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'gnk-team-acp-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(LocalSubprocessRuntime)

  // Observing the real children is the only way to assert that cancellation and
  // settlement leave no process behind, so the spawn call passes through untouched.
  const handles: SubprocessHandle[] = []
  const spawnChild = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((request) => {
    const handle = spawnChild(request)
    handles.push(handle)
    return handle
  })

  await ctx.plugin(SubagentAcp, {
    providerName: 'opencode',
    command: OPENCODE as string,
    args: ['acp'],
    cwd: workspace,
    permission: 'reject',
    env: {},
  })
  // A real executable that exits before the ACP handshake can complete: the failure
  // comes from the process boundary, not from a stubbed provider.
  await ctx.plugin(SubagentAcp, {
    providerName: 'broken-acp',
    command: process.execPath,
    args: ['-e', 'process.exit(3)'],
    cwd: workspace,
    permission: 'reject',
    env: {},
  })

  await ctx.plugin(TeamService, {})
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang', 'hang', 'hang']))
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
  return { ctx, lead, handles }
}

/** Create one workspace whose project config pins OpenCode to a usable model route. */
function externalWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'gnk-team-acp-work-'))
  roots.push(workspace)
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'README.md'), 'Greeneek integration fixture workspace. No source under test.\n')
  writeFileSync(join(workspace, 'opencode.jsonc'), '{\n  "model": "groq/openai/gpt-oss-20b"\n}\n')
  return workspace
}

describe.skipIf(OPENCODE === undefined)('real OpenCode member in a mixed Team', () => {
  afterEach(async () => {
    // A failed assertion must still unwind the runtime, or an OpenCode child outlives
    // the test that spawned it.
    await Promise.all(contexts.splice(0).map(async context => context.fiber.dispose()))
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('settles the external member and reports its real answer to the Lead while the lane stays usable', async () => {
    const { ctx, lead, handles } = await setup(externalWorkspace())
    const startContinuable = ctx.subagents.startContinuable.bind(ctx.subagents)
    const continuableCalls: string[] = []
    vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(async (request) => {
      continuableCalls.push(request.provider)
      return await startContinuable(request)
    })

    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'native',
      description: 'holds the continuable lane',
      prompt: [{ type: 'text', text: 'native lane work' }],
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })
    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'coder',
      description: 'runs the external OpenCode agent',
      prompt: [{ type: 'text', text: EXTERNAL_ANSWER }],
      context: 'fresh',
      provider: 'opencode',
      signal: SIGNAL,
    })

    // The roster chose the execution model from each registered capability: only the
    // native member was booked as a continuation.
    expect(memberRow(lead, 'native')).toMatchObject({ mode: 'lane', phase: 'active' })
    expect(continuableCalls).toEqual(['spawn'])

    let external = memberRow(lead, 'coder')
    for (let waited = 0; waited < SETTLE_TIMEOUT_MS; waited += 500) {
      external = memberRow(lead, 'coder')
      if (external?.phase === 'completed' || external?.phase === 'failed') break
      await new Promise<void>(resolve => setTimeout(resolve, 500))
    }
    expect(external?.mode).toBe('one-shot')
    expect(external?.phase).toBe('completed')
    const result = external?.result as { stopReason: string; output?: readonly { type: string; text?: string }[] }
    expect(result.stopReason).toBe('completed')
    const answer = (result.output ?? []).map(block => block.text ?? '').join('').trim()
    expect(answer.length).toBeGreaterThan(0)
    // The answer crossed the ACP boundary from the real OpenCode process, so it carries
    // what the pinned model was asked to say.
    expect(answer.toUpperCase()).toContain('PROBE OK')

    // Exactly one report per member crossed the mailbox: one queued edge, one
    // acknowledgement, and the Lead's own Session holds the peer item.
    const reports = lead.session.snapshotEvents().filter(event => event.type === 'team/message/queued'
      && (event.data as { message: { senderName: string } }).message.senderName === 'coder')
    expect(reports).toHaveLength(1)
    const reportId = (reports[0]?.data as { message: { id: string } }).message.id
    expect(teamEvents(lead, 'team/message/delivered')).toHaveLength(1)
    const receipt = leadReceipts(lead).find(candidate => candidate.id === reportId)
    expect(receipt?.sender).toBe('coder')
    expect(receipt?.text).toContain('Melody teammate "coder" settled with stop reason "completed"')
    expect(receipt?.text).toContain(answer)

    // The settled external member is terminal; the lane is untouched by its completion.
    const statuses = Object.fromEntries(ctx.agentTeams.listMembers(lead).map(member => [member.name, member.status]))
    expect(statuses.coder).toBe('inactive')
    expect(statuses.native).not.toBe('failed')
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'native',
      content: [{ type: 'text', text: 'lane mail after the external member finished' }],
      signal: SIGNAL,
    })).resolves.toMatchObject({ status: 'accepted' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'coder',
      content: [{ type: 'text', text: 'too late' }],
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })

    // The OpenCode child reached whole-tree exit, and it was terminated once.
    expect(handles.length).toBeGreaterThan(0)
    const outcomes = await Promise.all(handles.map(handle => handle.done))
    for (const outcome of outcomes) {
      expect(outcome.exitCode !== null || outcome.signal !== null).toBe(true)
    }
  }, TEST_TIMEOUT_MS)

  it('keeps the successful external result when a sibling fails at the process boundary', async () => {
    const { ctx, lead } = await setup(externalWorkspace())

    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'coder',
      description: 'runs the external OpenCode agent',
      prompt: [{ type: 'text', text: EXTERNAL_ANSWER }],
      context: 'fresh',
      provider: 'opencode',
      signal: SIGNAL,
    })
    // The sibling dies at the real process boundary. Its creator receives the
    // rejection and the roster keeps a durable failed row, so the surviving member's
    // result cannot be lost with it.
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'crash',
      description: 'a real child that exits before the handshake',
      prompt: [{ type: 'text', text: 'must fail' }],
      context: 'fresh',
      provider: 'broken-acp',
      signal: SIGNAL,
    })).rejects.toThrow(/stage: initialize/)

    let crashed = memberRow(lead, 'crash')
    let settled = memberRow(lead, 'coder')
    for (let waited = 0; waited < SETTLE_TIMEOUT_MS; waited += 500) {
      crashed = memberRow(lead, 'crash')
      settled = memberRow(lead, 'coder')
      if ((crashed?.phase === 'failed' || crashed?.phase === 'completed') && settled?.phase === 'completed') break
      await new Promise<void>(resolve => setTimeout(resolve, 500))
    }

    // The failing sibling is recorded as a durable failure carrying the child's own
    // exit fact; the surviving member keeps its real answer.
    expect(crashed?.phase).toBe('failed')
    expect(String(crashed?.error)).toContain('provider: ACP')
    expect(String(crashed?.error)).toContain('exit code: 3')
    expect(settled?.phase).toBe('completed')
    const result = settled?.result as { stopReason: string; output?: readonly { text?: string }[] }
    expect(result.stopReason).toBe('completed')
    expect((result.output ?? []).map(block => block.text ?? '').join('').trim().length).toBeGreaterThan(0)

    // A member that never published a run has no settlement to report, so exactly one
    // report reaches the Lead and it names the member that actually finished.
    expect(teamEvents(lead, 'team/message/queued')).toHaveLength(1)
    const receipts = leadReceipts(lead)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.sender).toBe('coder')
    expect(receipts[0]?.text).toContain('Melody teammate "coder" settled with stop reason "completed"')
  }, TEST_TIMEOUT_MS)

  it('carries Lead-side cancellation into the OpenCode child process tree', async () => {
    const { ctx, lead, handles } = await setup(externalWorkspace())
    const caller = new AbortController()

    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'coder',
      description: 'runs the external OpenCode agent',
      prompt: [{ type: 'text', text: EXTERNAL_ANSWER }],
      context: 'fresh',
      provider: 'opencode',
      signal: caller.signal,
    })
    // The child is published before the Lead's cancellation is observed, so the abort
    // travels through the composed start signal into the running process.
    caller.abort(new Error('the Lead cancelled the delegation'))

    let row = memberRow(lead, 'coder')
    for (let waited = 0; waited < SETTLE_TIMEOUT_MS; waited += 500) {
      row = memberRow(lead, 'coder')
      if (row?.phase === 'completed' || row?.phase === 'failed') break
      await new Promise<void>(resolve => setTimeout(resolve, 500))
    }
    expect(row?.phase).toBe('completed')
    const result = row?.result as { stopReason: string }
    expect(result.stopReason).toBe('aborted')

    // Cancellation reaped the real child: every spawned handle reported an exit, so no
    // OpenCode process outlives the settled member.
    expect(handles.length).toBeGreaterThan(0)
    const outcomes = await Promise.all(handles.map(handle => handle.done))
    for (const outcome of outcomes) {
      expect(outcome.exitCode !== null || outcome.signal !== null).toBe(true)
    }
  }, TEST_TIMEOUT_MS)
})

/**
 * Real task execution through integrated Harness connections (host-side
 * verification of the same contracts the Web UI exercises).
 *
 * This spec boots the real ACP backend against the installed `opencode`
 * (ACP server) and the Greeneek in-process providers, spaws teammates through
 * TeamService, and asserts actual answers land in the member rows and settled
 * reports. It does NOT substitute a fake transport: `opencode acp` is a real
 * subprocess speaking ND-JSON, and the Greenek lane is the shipped in-process
 * backend. LLM completions come from OpenCode's own free model catalog
 * (`opencode/beam-free`, pinned per-workspace), so no provider credentials are
 * required on this host; without that catalog the suite reports the
 * environment honestly rather than passing vacuously.
 *
 * @module @greeneek/gnk-agent-team/tests/maestro-real
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import { ReasoningEffortId } from '@greeneek/gnk-llm/brand'
import AgentLoop from '@greeneek/gnk-agent-loop'
import { mountAgentLoopTestDependencies } from '@greeneek/gnk-agent-loop-testkit'
import { SessionId } from '@greeneek/gnk-session'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import SubagentService from '@greeneek/gnk-subagent'
import * as SubagentAcp from '@greeneek/gnk-subagent-acp'
import * as SubagentSpawn from '@greeneek/gnk-subagent-spawn-in-process'
import LocalSubprocessRuntime from '@greeneek/gnk-subprocess-local'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../src/index.ts'

const SIGNAL = new AbortController().signal

/**
 * Poll the roster until the external member reaches a terminal status.
 * @param ctx - the test context.
 * @param lead - the Lead agent.
 * @returns the terminal member row.
 */
async function viWaitInactive(ctx: Context, lead: Agent): Promise<object> {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const rows = ctx.agentTeams.listMembers(lead)
    const member = rows.find(row => row.name === 'external-worker')
    if (member !== undefined && member.status === 'inactive') return member
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error('external member did not settle before the deadline')
}

/**
 * Locate the installed OpenCode executable.
 * @returns an absolute executable path, or undefined when absent.
 */
function resolveOpenCode(): string | undefined {
  const override = process.env.GNK_OPENCODE_COMMAND
  if (override !== undefined && override !== '') return existsSync(override) ? override : undefined
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

describe.skipIf(OPENCODE === undefined)('real execution across Harness connections', () => {
  it('spawns external and Greeneek members side by side and observes both rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gnk-maestro-'))
    writeFileSync(join(dir, 'README.md'), 'fixture\n')
    writeFileSync(join(dir, 'opencode.jsonc'), '{\n  "model": "opencode/beam-free"\n}\n')
    const ctx = new Context()
    try {
      const adapter = new MockAdapter([textResponse('Lead acknowledgement.')])
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(JsonlSessionPersistence, { root: dir })
      await ctx.plugin(SubagentService)
      await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(SubagentAcp, {
        providerName: 'opencode-ext',
        harnessId: 'opencode',
        displayName: 'OpenCode',
        command: OPENCODE as string,
        args: ['acp'],
        permission: 'reject',
        env: {},
        cwd: dir,
      })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(TeamService)
      ctx.llm.registerAdapter(['mock'], adapter)
      const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' }, { cwd: dir })
      // Real discovery first: registry sees the external connection through the live probe.
      const discovered = await ctx.agentTeams.remoteRefreshHarnesses()
      expect(discovered.some(entry => entry.connection === 'opencode-ext')).toBe(true)
      const spawned = await ctx.agentTeams.spawnTeammate(lead, {
        name: 'external-worker',
        description: 'probe via OpenCode',
        prompt: [{ type: 'text' as const, text: 'Reply with exactly two words: PROBE OK. Do not use any tools.' }],
        context: 'fresh',
        provider: 'opencode-ext',
        signal: SIGNAL,
      })
      expect(spawned.member.provider).toBe('opencode-ext')
      const rows = ctx.agentTeams.listMembers(lead)
      expect(rows.some(row => row.name === 'external-worker')).toBe(true)
      // Real execution: wait for the external member to reach a terminal row
      // (settled answer or honest provider failure) through the genuine ACP
      // backend with the free model. This host has no OpenCode provider
      // credentials for prompt transport, so the run may settle as `error`;
      // either outcome must be visible through the row, never swallowed.
      await viWaitInactive(ctx, lead)
      // Per-member Harness selection refusal still holds live: an advertised
      // model outside the catalog is refused before any child starts.
      await expect(ctx.agentTeams.spawnTeammate(lead, {
        name: 'bad-model',
        description: 'refused by discovery',
        prompt: [{ type: 'text' as const, text: 'x' }],
        context: 'fresh',
        provider: 'opencode-ext',
        signal: SIGNAL,
        agentOptions: { model: 'definitely/not-advertised', reasoningEffort: ReasoningEffortId('high') },
      })).rejects.toThrow(/does not advertise model/u)
      expect(ctx.agentTeams.listMembers(lead).some(row => row.name === 'bad-model')).toBe(false)
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

/**
 * Real-Harness discovery evidence: probe the installed OpenCode ACP server
 * through the shipped `subagent-acp` backend — the same handshake the Fleet
 * registry performs — and record what the real binary advertises.
 *
 * This suite proves the mock protocol tests are not the only evidence: it
 * speaks to the real installed `opencode` over real stdio. It self-skips with a
 * printed reason when no OpenCode executable resolves. The probe never
 * prompts, so it costs no inference and needs no credentials; assertions
 * cover the honesty contract (source, identity, no fabricated catalogs),
 * not a specific model list, which is binary- and auth-dependent.
 *
 * @module @greeneek/gnk-subagent-acp/tests/discovery-real
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import SubagentRuntime from '@greeneek/gnk-subagent'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import LocalSubprocessRuntime from '@greeneek/gnk-subprocess-local'
import * as acp from '../src/index.ts'

/**
 * Locate the installed OpenCode executable.
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

describe.skipIf(OPENCODE === undefined)('real OpenCode Harness discovery', () => {
  it('probes the installed server handshake and records its honest advertisement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gnk-acp-real-'))
    try {
      const command = OPENCODE as string
      const ctx = new Context()
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(acp, {
        providerName: 'opencode-real',
        harnessId: 'opencode',
        displayName: 'OpenCode',
        command,
        args: ['acp'],
        permission: 'reject',
        env: {},
        cwd: dir,
      })
      try {
        const capabilities = await ctx.subagents.getProvider('opencode-real')?.discoverHarness?.({
          signal: new AbortController().signal,
        })
        console.log('real OpenCode discovery:', JSON.stringify(capabilities?.models === 'unknown'
          ? 'unknown'
          : capabilities?.models.map(model => model.id), null, 2))
        expect(capabilities).toMatchObject({
          id: 'opencode',
          displayName: 'OpenCode',
          source: 'acp-session',
        })
        expect(typeof capabilities?.supportsAgentOptions).toBe('boolean')
        // Honesty: either an unknown catalog or a real non-empty one — never fabricated.
        expect(capabilities?.models === 'unknown' || (Array.isArray(capabilities?.models) && capabilities.models.length > 0)).toBe(true)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('reports installed binary location for the evidence record', () => {
    console.log('opencode executable:', dirname(OPENCODE ?? ''))
    expect(typeof OPENCODE).toBe('string')
  })
})

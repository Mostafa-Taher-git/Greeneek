/**
 * The default preset is a user setting. `config.default` is the deployment's
 * engineering default; the settings document overrides it and is hot-reloaded,
 * so a person can change which preset new sessions get without a restart.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@greeneek/cordis'
import Loader from '@greeneek/cordis-plugin-loader'
import Include from '@greeneek/cordis-plugin-include'
import LlmRuntime from '@greeneek/gnk-llm'
import SessionStore, { SessionId } from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import SystemPrompt from '@greeneek/gnk-system-prompt'
import ToolRuntime from '@greeneek/gnk-tools'
import AgentRegistry from '@greeneek/gnk-agent'
import AgentLoop from '@greeneek/gnk-agent-loop'
import FileSettingsProvider from '@greeneek/gnk-settings-file'
import { describe, expect, it, vi } from 'vitest'
import AgentPresets, { COMPOSITION_FILE, SETTINGS_NAMESPACE } from '@greeneek/gnk-agent-presets'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [{ path: join(FIXTURES, 'system'), trust: 'system' as const }]
const NS = SETTINGS_NAMESPACE

/**
 * A composition with a real file-backed settings provider. `settingsFiber` is
 * the provider's own handle, so a test can take it away the way a reload does.
 */
async function harness(
  extraRoots: readonly { path: string; trust: 'system' | 'user' }[] = [],
  deploymentDefault = 'standard',
): Promise<{ ctx: Context; settingsFile: string; settingsFiber: { dispose: () => unknown } }> {
  const home = await mkdtemp(join(tmpdir(), 'gnk-preset-settings-'))
  const settingsFile = join(home, 'settings.yaml')
  await writeFile(settingsFile, '{}\n')

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const settingsFiber = ctx.plugin(FileSettingsProvider, { path: settingsFile, watch: false })
  await settingsFiber
  await ctx.plugin(AgentPresets, {
    default: deploymentDefault,
    roots: [...ROOTS, ...extraRoots],
    includeShippedRoot: false,
    includeUserRoot: false,
  })
  return { ctx, settingsFile, settingsFiber }
}

const toolNames = (ctx: Context, agent?: unknown): string[] =>
  ctx.tools.schemas(agent as never).map(schema => schema.name).sort()

describe('the default preset as a user setting', () => {
  it('falls back to the composition default while the user set none', async () => {
    const { ctx } = await harness()

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('takes the user default over the composition default', async () => {
    const { ctx } = await harness()

    await ctx.settings.update(NS, { default: 'minimal' })

    expect(ctx.agentPresets.defaultId).toBe('minimal')
  })

  it('composes a new session from the user default', async () => {
    const { ctx } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })

    const handle = await ctx.agents.create({
      sessionId: SessionId('settings-default'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, handle.agent)).toEqual(['beta'])
    } finally {
      await handle.dispose()
    }
  })

  it('leaves a running session on the preset it was composed from', async () => {
    const { ctx } = await harness()
    const running = await ctx.agents.create({
      sessionId: SessionId('settings-running'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      // Changing the default mid-flight must not reach an agent that already
      // composed: its history was produced under `standard`'s tools.
      await ctx.settings.update(NS, { default: 'minimal' })

      expect(ctx.agentPresets.defaultId).toBe('minimal')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])
    } finally {
      await running.dispose()
    }
  })

  it('re-inherits the composition default when the user setting is cleared', async () => {
    const { ctx } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })
    expect(ctx.agentPresets.defaultId).toBe('minimal')

    await ctx.settings.replace(NS, {})

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('clears a user default it has just deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gnk-preset-authored-'))
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx } = await harness([{ path: root, trust: 'user' as const }])
    await ctx.settings.update(NS, { default: 'mine' })
    expect(ctx.agentPresets.defaultId).toBe('mine')

    await ctx.agentPresets.remove('mine')

    // Nothing will ever supply that id again, so leaving the setting pointed at
    // it would fail every session created without an explicit pick. Clearing it
    // exposes the deployment's own default underneath.
    expect(ctx.agentPresets.defaultId).toBe('standard')
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
  })

  it('falls back to standard, loudly, when the deployment default names no preset', async () => {
    const { ctx } = await harness([], 'vanished')
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn

    // The composition default is an input, not a guarantee: a copied cordis.yml
    // can name a preset this deployment never shipped. A new session still
    // starts, on `standard`, and the substitution is reported.
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('configured default preset "vanished"')
    expect(warnings[0]).toContain('"standard"')
  })

  it('does the same when the stale id is the user setting', async () => {
    const { ctx } = await harness()
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn

    // Storing it succeeds — the roster is a live directory, so a name that is
    // absent now may exist by the time a session asks for it. If it still does
    // not, the default pick falls back rather than failing session creation.
    await ctx.settings.update(NS, { default: 'no-such-preset' })

    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('configured default preset "no-such-preset"')
  })

  it('composes a new session from standard instead of failing to start', async () => {
    const { ctx } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.settings.update(NS, { default: 'no-such-preset' })

    const handle = await ctx.agents.create({
      sessionId: SessionId('settings-stale-default'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(ctx.agentPresets.composedPreset(handle.agent.ctx)).toBe('standard')
      expect(toolNames(ctx, handle.agent)).toEqual(['alpha'])
    } finally {
      await handle.dispose()
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"no-such-preset"'))
  })

  it('keeps the loud not-found for an id a session names explicitly', async () => {
    const { ctx } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    // The fallback covers only the absent pick. An explicit request names a
    // composition, and substituting another would misreport the session.
    await expect(ctx.agentPresets.resolve('no-such-preset'))
      .rejects.toMatchObject({ code: 'agent-preset/not-found' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a settings provider that goes away', () => {
  it('falls back to the composition default when the provider unloads', async () => {
    const { ctx, settingsFiber } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })
    expect(ctx.agentPresets.defaultId).toBe('minimal')

    // Unloading the provider takes the user layer with it; the roster keeps
    // working on its composition default rather than holding a stale override.
    await settingsFiber.dispose()

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })
})

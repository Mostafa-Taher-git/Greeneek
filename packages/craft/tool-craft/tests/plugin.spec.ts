import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftError, loadPilotCatalog } from '@greeneek/gnk-craft'
import type { CraftStatus } from '@greeneek/gnk-craft'
import {
  CRAFT_LIST_APPS,
  CRAFT_OPEN_APP,
  parseOpenArguments,
  renderAppList,
  renderOpenSummary,
} from '../src/plugin.ts'
import { createHarness, execution, failingRecipeCatalog, FakeProvider, reviewedCatalog, textOf } from './harness.ts'

const WORKSPACE = join(process.cwd(), 'craft-plugin-ws')
const ARTIFACTS = join(WORKSPACE, 'out')

/** Collect every warning emitted through the context logger. */
function captureWarnings(ctx: { logger: { warn: unknown } }): string[] {
  const warnings: string[] = []
  ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) })
  return warnings
}

describe('gateway registration', () => {
  it('mounts exactly the two gateway tools and removes them on disposal', async () => {
    const { ctx, fiber } = await createHarness()

    expect(ctx.tools.get(CRAFT_LIST_APPS)).toBeDefined()
    expect(ctx.tools.get(CRAFT_OPEN_APP)).toBeDefined()

    await fiber.dispose()

    expect(ctx.tools.get(CRAFT_LIST_APPS)).toBeUndefined()
    expect(ctx.tools.get(CRAFT_OPEN_APP)).toBeUndefined()
  })

  it('lists every pilot app with its measured state and detail', async () => {
    const provider = new FakeProvider({
      discovery: { state: 'app-installed-cli-missing', detail: 'the cli is not on PATH' },
    })
    const { ctx } = await createHarness({ provider })

    const text = textOf(await ctx.tools.execute(execution(CRAFT_LIST_APPS, {})))

    expect(text).toBe(
      'PhotoCraft (photocraft): app-installed-cli-missing — the cli is not on PATH\n'
      + 'PdfCraft (pdfcraft): app-installed-cli-missing — the cli is not on PATH',
    )
  })
})

describe('craft_open_app', () => {
  it('opens a headless session, mounts filtered tools, and registers the recipe', async () => {
    const { ctx, provider } = await createHarness()

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    expect(textOf(result)).toBe(
      `PhotoCraft (photocraft) is running. Artifacts belong under ${ARTIFACTS}. `
      + 'Mounted tools: mcp__photocraft__command_list, mcp__photocraft__command_run, mcp__photocraft__render_preview.',
    )
    expect(provider.opens).toHaveLength(1)
    expect(provider.opens[0]?.workspaceRoot).toBe(WORKSPACE)
    expect(provider.opens[0]?.roots).toEqual({ read: WORKSPACE, write: ARTIFACTS })
    expect(provider.opens[0]?.controlToken.length).toBeGreaterThan(0)
    expect(ctx.tools.get('mcp__photocraft__command_run')).toBeDefined()
    expect(ctx.tools.get('mcp__photocraft__system_shell')).toBeUndefined()
    const skills = await ctx.skills.list()
    expect(skills.find(skill => skill.name === 'craft-photocraft')?.source).toBe('runtime')

    const listed = textOf(await ctx.tools.execute(execution(CRAFT_LIST_APPS, {})))
    expect(listed).toContain('PhotoCraft (photocraft): running')
  })

  it('mounts tools without a recipe when no registry baseline was reviewed', async () => {
    const { ctx } = await createHarness({ catalog: loadPilotCatalog() })

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    expect(result.isError).not.toBe(true)
    expect(ctx.tools.get('mcp__photocraft__command_run')).toBeDefined()
    expect((await ctx.skills.list()).find(skill => skill.name === 'craft-photocraft')).toBeUndefined()
  })

  it('rejects registry drift without mounting tools or a recipe and reports the retained state', async () => {
    const provider = new FakeProvider({ registry: { commands: [{ id: 'changed' }] } })
    const { ctx } = await createHarness({ provider, catalog: reviewedCatalog() })

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('command registry drifted')
    expect(provider.transports[0]?.closed).toBe(true)
    expect(ctx.tools.get('mcp__photocraft__command_run')).toBeUndefined()
    expect((await ctx.skills.list()).find(skill => skill.name === 'craft-photocraft')).toBeUndefined()
    expect(textOf(await ctx.tools.execute(execution(CRAFT_LIST_APPS, {})))).toContain('PhotoCraft (photocraft): drifted')
  })

  it('falls back to the process workspace when the caller has no agent', async () => {
    const { ctx, provider } = await createHarness()

    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }))

    expect(provider.opens[0]?.workspaceRoot).toBe(process.cwd())
  })

  it('resolves an alias to the canonical bridge namespace', async () => {
    const { ctx } = await createHarness()

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'printcraft' }, WORKSPACE))

    expect(textOf(result)).toContain('PdfCraft (pdfcraft) is running.')
    expect(ctx.tools.get('mcp__pdfcraft__command_run')).toBeDefined()
    expect(ctx.tools.get('mcp__printcraft__command_run')).toBeUndefined()
  })

  it('returns the existing summary without opening the same app twice', async () => {
    const { ctx, provider } = await createHarness()

    const first = textOf(await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE)))
    const second = textOf(await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE)))

    expect(second).toBe(first)
    expect(provider.opens).toHaveLength(1)
  })

  it('refuses attach mode for a pilot app without spawning', async () => {
    const { ctx, provider } = await createHarness()

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft', mode: 'attach' }, WORKSPACE))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('attach mode is disabled for "photocraft"')
    expect(provider.opens).toHaveLength(0)
  })

  it('closes an active app, then reports it as not open', async () => {
    const { ctx, provider } = await createHarness()
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    const closed = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft', mode: 'close' }, WORKSPACE))

    expect(textOf(closed)).toBe('PhotoCraft (photocraft): closed')
    expect(provider.transports[0]?.closed).toBe(true)
    expect(ctx.tools.get('mcp__photocraft__command_run')).toBeUndefined()
    expect((await ctx.skills.list()).find(skill => skill.name === 'craft-photocraft')).toBeUndefined()

    const again = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft', mode: 'close' }, WORKSPACE))
    expect(textOf(again)).toBe('PhotoCraft (photocraft): not-open')
  })

  it('rejects unknown apps without crashing', async () => {
    const { ctx } = await createHarness()

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'gimp' }, WORKSPACE))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Craft app "gimp" is not in the v0.3.4 pilot')
  })

  it('rejects a missing app id and an unknown mode', async () => {
    const { ctx } = await createHarness()

    const missing = await ctx.tools.execute(execution(CRAFT_OPEN_APP, {}, WORKSPACE))
    const badMode = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft', mode: 'gui' }, WORKSPACE))

    expect(textOf(missing)).toContain('requires a non-empty "app" string')
    expect(textOf(badMode)).toContain('does not accept mode "gui"')
  })

  it('closes the session and rolls back the bridge when the recipe cannot load', async () => {
    const provider = new FakeProvider()
    const { ctx } = await createHarness({ provider, catalog: failingRecipeCatalog() })

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('recipe read failed')
    expect(ctx.tools.get('mcp__photocraft__command_list')).toBeUndefined()
    expect((await ctx.skills.list()).find(skill => skill.name === 'craft-photocraft')).toBeUndefined()
    expect(provider.transports[0]?.closed).toBe(true)
  })

  it('warns when closing after a mount failure also fails', async () => {
    const provider = new FakeProvider()
    provider.closeError = new Error('cannot kill the child')
    const { ctx } = await createHarness({ provider, catalog: failingRecipeCatalog() })
    const warnings = captureWarnings(ctx)

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    expect(result.isError).toBe(true)
    expect(warnings.some(warning => warning.includes('after a mount failure')
      && warning.includes('cannot kill the child'))).toBe(true)
  })

  it('closes the session and rolls back when a bridge name is already occupied', async () => {
    const { ctx, provider } = await createHarness()
    ctx.tools.register({
      name: 'mcp__photocraft__command_run',
      description: 'Squatter',
      parameters: { type: 'object' },
      output: { schema: {}, render: () => [{ type: 'text', text: 'squatter' }] },
      execute: async () => ({}),
    })

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))

    expect(result.isError).toBe(true)
    expect(provider.transports[0]?.closed).toBe(true)
    expect((await ctx.craft.status('photocraft')).state).toBe('ready')
  })

  it('warns when an app refuses to close', async () => {
    const { ctx, provider } = await createHarness()
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))
    provider.closeError = new Error('kill failed')
    const warnings = captureWarnings(ctx)

    const result = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft', mode: 'close' }, WORKSPACE))

    expect(textOf(result)).toBe('PhotoCraft (photocraft): closed')
    expect(warnings.some(warning => warning.includes('failed to close PhotoCraft')
      && warning.includes('kill failed'))).toBe(true)
  })

  it('releases every active session on disposal', async () => {
    const { ctx, fiber, provider } = await createHarness()
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, WORKSPACE))
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, WORKSPACE))
    expect(provider.transports).toHaveLength(2)

    await fiber.dispose()

    expect(provider.transports.map(transport => transport.closed)).toEqual([true, true])
    expect(ctx.tools.get('mcp__photocraft__command_run')).toBeUndefined()
    expect(ctx.tools.get('mcp__pdfcraft__command_run')).toBeUndefined()
    expect((await ctx.skills.list()).find(skill => skill.name === 'craft-photocraft')).toBeUndefined()
  })
})

describe('renderAppList', () => {
  it('renders a placeholder when the catalog is empty', () => {
    expect(renderAppList({ apps: [] })).toBe('No Craft apps are available.')
  })

  it('renders one line per app and only appends a present detail', () => {
    const apps: CraftStatus[] = [
      { app: 'photocraft', displayName: 'PhotoCraft', state: 'ready' },
      { app: 'pdfcraft', displayName: 'PdfCraft', state: 'not-installed', detail: 'not found' },
    ]

    expect(renderAppList({ apps })).toBe(
      'PhotoCraft (photocraft): ready\nPdfCraft (pdfcraft): not-installed — not found',
    )
  })
})

describe('renderOpenSummary', () => {
  it('renders the artifact root and every mounted tool', () => {
    expect(renderOpenSummary({
      app: 'photocraft',
      displayName: 'PhotoCraft',
      state: 'running',
      tools: ['mcp__photocraft__command_run'],
      artifactsRoot: ARTIFACTS,
    })).toBe(
      `PhotoCraft (photocraft) is running. Artifacts belong under ${ARTIFACTS}. `
      + 'Mounted tools: mcp__photocraft__command_run.',
    )
  })

  it('renders unknown values when the session omitted them', () => {
    expect(renderOpenSummary({ app: 'photocraft', displayName: 'PhotoCraft', state: 'running' })).toBe(
      'PhotoCraft (photocraft) is running. Artifacts belong under (unknown root). Mounted tools: none.',
    )
  })

  it('renders a terminal state without the running details', () => {
    expect(renderOpenSummary({ app: 'pdfcraft', displayName: 'PdfCraft', state: 'not-open' }))
      .toBe('PdfCraft (pdfcraft): not-open')
  })
})

describe('parseOpenArguments', () => {
  it('defaults the mode to headless', () => {
    expect(parseOpenArguments({ app: 'photocraft' })).toEqual({ app: 'photocraft', mode: 'headless' })
  })

  it('keeps explicit attach and close modes', () => {
    expect(parseOpenArguments({ app: 'printcraft', mode: 'attach' }))
      .toEqual({ app: 'printcraft', mode: 'attach' })
    expect(parseOpenArguments({ app: 'printcraft', mode: 'close' }))
      .toEqual({ app: 'printcraft', mode: 'close' })
  })

  it('rejects a non-object argument payload', () => {
    for (const args of [null, 'photocraft', ['photocraft']]) {
      expect(() => parseOpenArguments(args)).toThrow(CraftError)
      expect(() => parseOpenArguments(args)).toThrow('requires an object with an "app" field')
    }
  })

  it('rejects a missing, blank, or non-string app id', () => {
    for (const app of [undefined, '', '   ', 42]) {
      expect(() => parseOpenArguments({ app })).toThrow('requires a non-empty "app" string')
    }
  })

  it('rejects a mode outside the gateway contract', () => {
    expect(() => parseOpenArguments({ app: 'photocraft', mode: 'launch' }))
      .toThrow('does not accept mode "launch"')
  })
})

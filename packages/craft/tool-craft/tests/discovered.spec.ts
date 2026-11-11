import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRAFT_LIST_APPS, CRAFT_OPEN_APP } from '../src/plugin.ts'
import { createHarness, execution, FakeProvider, textOf } from './harness.ts'

const WORKSPACE = join(process.cwd(), 'craft-discovered-ws')

describe('discovered gateway', () => {
  it('lists an auto-detected app and opens it through the synthesized filter', async () => {
    const provider = new FakeProvider({
      installed: [{
        id: 'figcraft',
        displayName: 'FigCraft',
        installDir: '/apps/figcraft',
        version: '1.0.0',
        source: 'launcher-manifest',
      }],
    })
    const { ctx } = await createHarness({ provider })

    const listed = textOf(await ctx.tools.execute(execution(CRAFT_LIST_APPS, {})))
    expect(listed).toContain('FigCraft (figcraft): ready')

    const opened = textOf(await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'figcraft' }, WORKSPACE)))
    expect(opened).toContain('FigCraft (figcraft) is running.')
    // No hand-written manifest exists, so every observed tool mounts.
    expect(ctx.tools.get('mcp__figcraft__command_list')).toBeDefined()
    expect(ctx.tools.get('mcp__figcraft__system_shell')).toBeDefined()

    const closed = textOf(await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'figcraft', mode: 'close' }, WORKSPACE)))
    expect(closed).toBe('FigCraft (figcraft): closed')
    expect(ctx.tools.get('mcp__figcraft__command_list')).toBeUndefined()
  })

  it('rejects closing an unknown app', async () => {
    const { ctx } = await createHarness()

    const closed = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'gimp', mode: 'close' }, WORKSPACE))

    expect(closed.isError).toBe(true)
    expect(textOf(closed)).toContain('not in the v0.3.4 pilot')
  })

  it('still reports not-open when closing an unopened discovered app', async () => {
    const provider = new FakeProvider({
      installed: [{
        id: 'figcraft',
        displayName: 'FigCraft',
        installDir: '/apps/figcraft',
        source: 'os-registry',
      }],
    })
    const { ctx } = await createHarness({ provider })

    const closed = textOf(await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'figcraft', mode: 'close' }, WORKSPACE)))

    expect(closed).toBe('FigCraft (figcraft): not-open')
  })
})

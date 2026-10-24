import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { craftRoots, loadPilotCatalog } from '@greeneek/gnk-craft'
import type { CraftCallResult, CraftSession } from '@greeneek/gnk-craft'
import { registerAppTools, registerRecipeSkill } from '../src/bridge.ts'
import { createHarness, defaultTools, execution, FakeTransport, textOf } from './harness.ts'

const catalog = loadPilotCatalog()
const photocraft = catalog.require('photocraft')
const pdfcraft = catalog.require('pdfcraft')
const ROOTS = craftRoots(resolve('craft-bridge-ws'))

/** One live session fake over a recording transport. */
function sessionWith(
  respond: (name: string) => CraftCallResult = name => ({ content: [{ type: 'text', text: `ran ${name}` }] }),
  tools = defaultTools(),
): CraftSession & { transport: FakeTransport } {
  const transport = new FakeTransport(tools, respond)
  return {
    id: 'session-1',
    app: photocraft.id,
    mode: 'headless',
    roots: ROOTS,
    tools,
    transport,
    close: async () => { transport.closed = true },
  }
}

describe('registerAppTools', () => {
  it('registers only the manifest-filtered tools under the app namespace', async () => {
    const { ctx } = await createHarness()
    const session = sessionWith()

    const bridge = registerAppTools(ctx, session, photocraft)

    expect(bridge.names).toEqual([
      'mcp__photocraft__command_list',
      'mcp__photocraft__command_run',
      'mcp__photocraft__render_preview',
    ])
    expect(bridge.disposers).toHaveLength(3)
    expect(ctx.tools.get('mcp__photocraft__system_shell')).toBeUndefined()
    expect(ctx.tools.get('mcp__photocraft__command_run')?.description).toBe('Run a command (PhotoCraft)')
    expect(ctx.tools.get('mcp__photocraft__render_preview')?.description).toBe('Run render_preview in PhotoCraft')
  })

  it('rolls back every earlier registration when one name is occupied', async () => {
    const { ctx } = await createHarness()
    ctx.tools.register({
      name: 'mcp__photocraft__command_run',
      description: 'Squatter',
      parameters: { type: 'object' },
      output: { schema: {}, render: () => [{ type: 'text', text: 'squatter' }] },
      execute: async () => ({}),
    })
    const session = sessionWith()

    expect(() => registerAppTools(ctx, session, photocraft)).toThrow()
    expect(ctx.tools.get('mcp__photocraft__command_list')).toBeUndefined()
    expect(ctx.tools.get('mcp__photocraft__command_run')).toBeDefined()
  })

  it('forwards object arguments and the caller signal to the app', async () => {
    const { ctx } = await createHarness()
    const session = sessionWith()
    registerAppTools(ctx, session, photocraft)

    const result = await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'grade' }))
    const text = textOf(result)

    expect(text).toBe('ran command_run')
    expect(session.transport.calls).toHaveLength(1)
    expect(session.transport.calls[0]?.name).toBe('command_run')
    expect(session.transport.calls[0]?.args).toEqual({ command: 'grade' })
  })

  it('normalizes non-object arguments to an empty object', async () => {
    const { ctx } = await createHarness()
    const session = sessionWith()
    registerAppTools(ctx, session, photocraft)

    await ctx.tools.execute(execution('mcp__photocraft__command_run', [1, 2]))
    await ctx.tools.execute(execution('mcp__photocraft__command_run', null))

    expect(session.transport.calls.map(call => call.args)).toEqual([{}, {}])
  })

  it('returns the confined artifact paths in the model text', async () => {
    const { ctx } = await createHarness()
    const session = sessionWith(() => ({
      content: [{ type: 'text', text: 'rendered' }],
      artifacts: ['preview.png'],
    }))
    registerAppTools(ctx, session, photocraft)

    const result = await ctx.tools.execute(execution('mcp__photocraft__render_preview', {}))

    expect(textOf(result)).toBe(`rendered\n\nArtifacts:\n${join(ROOTS.write, 'preview.png')}`)
  })

  it('fails a call whose artifact escapes the job root', async () => {
    const { ctx } = await createHarness()
    const session = sessionWith(() => ({ content: [], artifacts: ['../escape.png'] }))
    registerAppTools(ctx, session, photocraft)

    const result = await ctx.tools.execute(execution('mcp__photocraft__render_preview', {}))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('escapes the job output root')
  })

  it('surfaces an app-reported failure as a tool error', async () => {
    const { ctx } = await createHarness()
    const session = sessionWith(() => ({
      content: [{ type: 'text', text: 'command failed' }],
      isError: true,
    }))
    registerAppTools(ctx, session, photocraft)

    const result = await ctx.tools.execute(execution('mcp__photocraft__command_run', {}))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('PhotoCraft reported "command_run" as failed: command failed')
  })

  it('renders the canonical value through the tool output contract', async () => {
    const { ctx } = await createHarness()
    registerAppTools(ctx, sessionWith(), photocraft)
    const definition = ctx.tools.get('mcp__photocraft__command_run')

    const blocks = definition?.output.render({}, { text: 'canonical', artifacts: [] })

    expect(blocks).toEqual([{ type: 'text', text: 'canonical' }])
  })
})

describe('registerRecipeSkill', () => {
  it('registers the app recipe as a runtime skill until disposed', async () => {
    const { ctx } = await createHarness()

    const dispose = registerRecipeSkill(ctx, pdfcraft)
    const registered = await ctx.skills.list()
    expect(registered.find(skill => skill.name === 'craft-pdfcraft')).toMatchObject({
      description: 'Run PdfCraft headless commands and collect rendered pages from the job out/ directory.',
      source: 'runtime',
    })

    dispose()
    const after = await ctx.skills.list()
    expect(after.find(skill => skill.name === 'craft-pdfcraft')).toBeUndefined()
  })
})

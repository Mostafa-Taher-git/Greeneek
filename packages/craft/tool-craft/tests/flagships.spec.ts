/**
 * Pixels Designer flagship fixtures at the real Craft gateway boundary:
 * real tool registry, policy, recipe registration, and artifact confinement,
 * with only the app transport faked. The model/preset conversation is not
 * part of this file; the rubric records that remaining evidence.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CRAFT_OPEN_APP } from '../src/plugin.ts'
import { createHarness, execution, FakeProvider, textOf } from './harness.ts'
import type { CraftCallResult } from '@greeneek/gnk-craft'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One isolated session workspace and its job out root. */
function workspace(): { root: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'gnk-flagship-'))
  roots.push(root)
  const out = join(root, 'out')
  mkdirSync(out, { recursive: true })
  return { root, out }
}

/** One fake app result with optional artifact names. */
function result(content: string, artifacts?: readonly string[]): CraftCallResult {
  return {
    content: [{ type: 'text', text: content }],
    ...artifacts === undefined ? {} : { artifacts },
  }
}

describe('Pixels Designer flagship fixtures', () => {
  it('produces a declared contact sheet that is re-read from bytes', async () => {
    const { root, out } = workspace()
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
    writeFileSync(join(out, 'contact-sheet.webp'), bytes)
    const provider = new FakeProvider({
      respond: () => result('batch completed', ['contact-sheet.webp']),
    })
    const { ctx } = await createHarness({ provider })

    expect((await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))).isError).toBe(false)
    const batch = await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'grade' }))
    const text = textOf(batch)

    expect(text).toContain('Artifacts:')
    expect(text).toContain(join(out, 'contact-sheet.webp'))
    expect(readFileSync(join(out, 'contact-sheet.webp'))).toEqual(bytes)
  })

  it('reports an empty candidate set without inventing an artifact', async () => {
    const { root, out } = workspace()
    const provider = new FakeProvider({
      respond: () => result('no candidate matched the brief'),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))

    const resultText = textOf(await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'cull' })))

    expect(resultText).toBe('no candidate matched the brief')
    expect(resultText).not.toContain('Artifacts:')
    expect(() => readFileSync(join(out, 'contact-sheet.webp'))).toThrow()
  })

  it('names a missing CLI instead of claiming the app ran', async () => {
    const { root } = workspace()
    const provider = new FakeProvider({
      discovery: { state: 'app-installed-cli-missing', detail: 'the photocraft CLI is missing' },
    })
    const { ctx } = await createHarness({ provider })

    const opened = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))

    expect(opened.isError).toBe(true)
    expect(textOf(opened)).toContain('the photocraft CLI is missing')
    expect(provider.transports).toHaveLength(0)
  })

  it('keeps the earlier artifact and reports a downstream open failure explicitly', async () => {
    const { root, out } = workspace()
    writeFileSync(join(out, 'contact-sheet.webp'), 'sheet\n')
    const provider = new FakeProvider({
      discovery: { state: 'ready', executable: '/apps/photocraft-cli' },
      respond: () => result('batch completed', ['contact-sheet.webp']),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))
    await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'grade' }))

    const pdf = await createHarness({
      provider: new FakeProvider({ discovery: { state: 'not-installed', detail: 'PdfCraft is not installed' } }),
    })
    const opened = await pdf.ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))

    expect(opened.isError).toBe(true)
    expect(textOf(opened)).toContain('PdfCraft is not installed')
    expect(readFileSync(join(out, 'contact-sheet.webp'), 'utf8')).toBe('sheet\n')
  })

  it('refuses an artifact outside the job root after registry drift', async () => {
    const { root } = workspace()
    const provider = new FakeProvider({
      respond: () => result('rendered', ['../escape.webp']),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))

    const rendered = await ctx.tools.execute(execution('mcp__photocraft__render_preview', {}))

    expect(rendered.isError).toBe(true)
    expect(textOf(rendered)).toContain('escapes the job output root')
  })
})

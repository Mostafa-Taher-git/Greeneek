/**
 * FULL-mode eval fixtures at the real Craft gateway boundary: real tool
 * registry, policy, recipe registration, and artifact confinement, with only
 * the app transport faked. Each fixture drives the gateway the way the
 * `pixels-designer` / `instructor` personas prescribe and asserts the
 * artifact, the honest-degrade text, or the CV export-gate verdict. The
 * model turn itself is not exercised here; the persona-contract fixtures in
 * `packages/preset/agent-presets/tests/full-mode.spec.ts` pin the prompt
 * half of these flows.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CRAFT_LIST_APPS, CRAFT_OPEN_APP } from '../src/plugin.ts'
import { createHarness, execution, FakeProvider, textOf } from './harness.ts'
import { cvExportDecision, evaluateCvTrace, loadPilotCatalog } from '@greeneek/gnk-craft'
import type { CraftCallResult, CraftToolDescriptor } from '@greeneek/gnk-craft'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One isolated session workspace and its job out root. */
function workspace(): { root: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'gnk-full-mode-'))
  roots.push(root)
  const out = join(root, 'out')
  mkdirSync(out, { recursive: true })
  return { root, out }
}

/** One bridge-level result with optional artifact names. */
function result(content: string, artifacts?: readonly string[]): CraftCallResult {
  return {
    content: [{ type: 'text', text: content }],
    ...artifacts === undefined ? {} : { artifacts },
  }
}

/** The PdfCraft tool slice the CV/layout flows route through. */
function pdfTools(): CraftToolDescriptor[] {
  return [
    { name: 'command_list', description: 'List commands', inputSchema: { type: 'object' } },
    { name: 'doc_create_multiple', description: 'Create a PDF', inputSchema: { type: 'object' } },
    { name: 'doc_info', description: 'Document info', inputSchema: { type: 'object' } },
  ]
}

describe('Pixels FULL-mode fixtures', () => {
  it('exports a poster page layout as a real PDF artifact through PdfCraft', async () => {
    const { root, out } = workspace()
    writeFileSync(join(out, 'poster.pdf'), '%PDF-1.7 fixture\n')
    const provider = new FakeProvider({
      tools: pdfTools(),
      respond: () => result('exported poster.pdf', ['poster.pdf']),
    })
    const { ctx } = await createHarness({ provider })

    expect((await ctx.tools.execute(execution(CRAFT_LIST_APPS, {}, root))).isError).toBe(false)
    expect((await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))).isError).toBe(false)
    const exported = await ctx.tools.execute(execution('mcp__pdfcraft__doc_create_multiple', { out: join(out, 'poster.pdf') }))

    expect(textOf(exported)).toContain('Artifacts:')
    expect(textOf(exported)).toContain(join(out, 'poster.pdf'))
    expect(readFileSync(join(out, 'poster.pdf'), 'utf8')).toBe('%PDF-1.7 fixture\n')
  })

  it('runs the photo batch as cull, grade, and contact-sheet steps in one session', async () => {
    const { root, out } = workspace()
    writeFileSync(join(root, 'img-1.png'), 'png-1')
    writeFileSync(join(root, 'img-2.png'), 'png-2')
    writeFileSync(join(out, 'contact-sheet.webp'), 'sheet')
    const provider = new FakeProvider({
      respond: name => name === 'render_preview'
        ? result('contact sheet rendered', ['contact-sheet.webp'])
        : result(`ran ${name}`),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))

    const cull = await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'cull' }))
    const grade = await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'grade' }))
    const sheet = await ctx.tools.execute(execution('mcp__photocraft__render_preview', {}))

    expect(textOf(cull)).toBe('ran command_run')
    expect(textOf(grade)).toBe('ran command_run')
    expect(textOf(sheet)).toContain(join(out, 'contact-sheet.webp'))
    const calls = provider.transports[0]!.calls.map(call => call.name)
    expect(calls).toEqual(['command_run', 'command_run', 'render_preview'])
  })

  it('degrades a vector/video/audio request to a named missing app and a workspace brief, never a false claim', async () => {
    const { root } = workspace()
    const provider = new FakeProvider({
      discovery: { state: 'not-installed', detail: 'no vector, video, or audio app was found' },
    })
    const { ctx } = await createHarness({ provider })

    const listed = await ctx.tools.execute(execution(CRAFT_LIST_APPS, {}, root))
    expect(textOf(listed)).toContain('PhotoCraft')
    expect(textOf(listed)).toContain('PdfCraft')

    const opened = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))
    expect(opened.isError).toBe(true)
    expect(textOf(opened)).toContain('no vector, video, or audio app was found')
    expect(provider.transports).toHaveLength(0)

    // The degrade path delivers the edit decision list as a workspace file
    // through the fs tools the preset mounts; this fixture proves the gateway
    // half of that promise (a refused open, no app claiming to have run).
    writeFileSync(join(root, 'edit-decision-list.md'), '# edit decision list\n')
    expect(readFileSync(join(root, 'edit-decision-list.md'), 'utf8')).toBe('# edit decision list\n')
  })

  it('keeps the graded batch artifact when a downstream layout open fails', async () => {
    const { root, out } = workspace()
    writeFileSync(join(out, 'contact-sheet.webp'), 'sheet\n')
    const provider = new FakeProvider({
      respond: () => result('batch completed', ['contact-sheet.webp']),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))
    await ctx.tools.execute(execution('mcp__photocraft__command_run', { command: 'grade' }))

    const second = await createHarness({
      provider: new FakeProvider({ discovery: { state: 'not-installed', detail: 'PdfCraft is not installed' } }),
    })
    const opened = await second.ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))

    expect(opened.isError).toBe(true)
    expect(textOf(opened)).toContain('PdfCraft is not installed')
    expect(readFileSync(join(out, 'contact-sheet.webp'), 'utf8')).toBe('sheet\n')
  })

  it('mounts no recipe skill while the app registry is unreviewed', async () => {
    const { root } = workspace()
    const provider = new FakeProvider()
    const { ctx } = await createHarness({ provider, catalog: loadPilotCatalog() })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'photocraft' }, root))

    const skills = await ctx.skills.list({ cwd: root })
    expect(skills.map(skill => skill.name)).not.toContain('craft-photocraft')
  })
})

describe('Instructor FULL-mode fixtures', () => {
  const claims = ['Ada Lovelace, software engineer', 'First programmer in history']
  const traces = [
    { claim: 'Ada Lovelace, software engineer', source: 'user-input' as const },
    { claim: 'First programmer in history', source: 'fetched' as const, sourceUrl: 'https://example.test/lovelace' },
  ]

  it('exports an approved, fully traced CV draft through PdfCraft', async () => {
    const { root, out } = workspace()
    writeFileSync(join(out, 'cv.pdf'), '%PDF-1.7 fixture\n')
    const trace = evaluateCvTrace(claims, traces)
    const gate = cvExportDecision({ traceOk: trace.ok, reviewDecision: 'approved', exportOutcome: 'not-attempted', pdfClaimed: false })
    expect(gate.mayExport).toBe(true)

    const provider = new FakeProvider({
      tools: pdfTools(),
      respond: () => result('exported cv.pdf', ['cv.pdf']),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))
    const exported = await ctx.tools.execute(execution('mcp__pdfcraft__doc_create_multiple', { out: join(out, 'cv.pdf') }))

    expect(textOf(exported)).toContain(join(out, 'cv.pdf'))
    expect(readFileSync(join(out, 'cv.pdf'), 'utf8')).toBe('%PDF-1.7 fixture\n')
    const after = cvExportDecision({ traceOk: trace.ok, reviewDecision: 'approved', exportOutcome: 'succeeded', pdfClaimed: true })
    expect(after.pdfClaimHonest).toBe(true)
  })

  it('returns a rejected CV review to revision and never reaches the export tool', async () => {
    workspace()
    const trace = evaluateCvTrace(claims, traces)
    const gate = cvExportDecision({ traceOk: trace.ok, reviewDecision: 'rejected', exportOutcome: 'not-attempted', pdfClaimed: false })
    expect(gate.mayExport).toBe(false)

    const provider = new FakeProvider({ tools: pdfTools() })
    const { ctx } = await createHarness({ provider })
    expect(gate.mayExport).toBe(false)
    // No craft_open_app export path is taken: the fixture never opens PdfCraft
    // for export, so the transport records zero export calls.
    expect(provider.transports).toHaveLength(0)
    void ctx
  })

  it('blocks export of a draft with an untraced claim even after approval', async () => {
    const trace = evaluateCvTrace([...claims, 'invented employer'], traces)
    expect(trace.ok).toBe(false)
    expect(trace.untracedClaims).toEqual(['invented employer'])

    const gate = cvExportDecision({ traceOk: trace.ok, reviewDecision: 'approved', exportOutcome: 'not-attempted', pdfClaimed: false })
    expect(gate.mayExport).toBe(false)
    expect(gate.reason).toContain('no user input or cited source')
  })

  it('never claims a PDF after a failed export', async () => {
    const { root } = workspace()
    const provider = new FakeProvider({
      tools: pdfTools(),
      respond: () => result('export failed: write denied', []),
    })
    const { ctx } = await createHarness({ provider })
    await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))
    const exported = await ctx.tools.execute(execution('mcp__pdfcraft__doc_create_multiple', { out: join(root, 'out', 'cv.pdf') }))
    expect(textOf(exported)).not.toContain('Artifacts:')

    const dishonest = cvExportDecision({ traceOk: true, reviewDecision: 'approved', exportOutcome: 'failed', pdfClaimed: true })
    expect(dishonest.pdfClaimHonest).toBe(false)
    const honest = cvExportDecision({ traceOk: true, reviewDecision: 'approved', exportOutcome: 'failed', pdfClaimed: false })
    expect(honest.pdfClaimHonest).toBe(true)
  })

  it('delivers the markdown draft and names the missing app when PdfCraft is not installed', async () => {
    const { root, out: _out } = workspace()
    void _out
    writeFileSync(join(root, 'cv.md'), '# Ada Lovelace\n')
    const provider = new FakeProvider({
      discovery: { state: 'not-installed', detail: 'PdfCraft is not installed' },
    })
    const { ctx } = await createHarness({ provider })

    const opened = await ctx.tools.execute(execution(CRAFT_OPEN_APP, { app: 'pdfcraft' }, root))
    expect(opened.isError).toBe(true)
    expect(textOf(opened)).toContain('PdfCraft is not installed')
    expect(provider.transports).toHaveLength(0)
    expect(readFileSync(join(root, 'cv.md'), 'utf8')).toBe('# Ada Lovelace\n')

    const gate = cvExportDecision({ traceOk: true, reviewDecision: 'approved', exportOutcome: 'not-attempted', pdfClaimed: false })
    expect(gate.pdfClaimHonest).toBe(true)
  })
})

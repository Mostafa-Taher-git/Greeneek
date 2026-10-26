/**
 * The shipped presets are this package's own, not an assembly fact each app
 * must patch in: a roster configured with nothing still supplies the built-in
 * compositions, prepended so they always mount and win a duplicate id.
 * `includeShippedRoot: false` is how a deployment supplying purely its own
 * presets — or an embedder using the roster as bare machinery — opts out.
 *
 * `$GNK_HOME` is repointed per test for the same reason as the user-root
 * suite: the derived writable root is resolved in the constructor.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@greeneek/cordis'
import Loader from '@greeneek/cordis-plugin-loader'
import Include, { entryListSchema } from '@greeneek/cordis-plugin-include'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentPresets, { SHIPPED_PRESET_ROOT, type Config } from '@greeneek/gnk-agent-presets'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SYSTEM_ROOT = join(FIXTURES, 'system')

let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.GNK_HOME
  process.env.GNK_HOME = await mkdtemp(join(tmpdir(), 'gnk-shipped-root-'))
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.GNK_HOME
  else process.env.GNK_HOME = previousHome
})

/** Boot a roster with the shipped root left to the plugin's default. */
async function roster(config: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [],
    includeShippedRoot: true,
    includeUserRoot: true,
    ...config,
  })
  return ctx
}

interface ShippedEntry {
  id?: unknown
  disabled?: unknown
  config?: unknown
}

/** Find one entry through the shipped composition's nested groups. */
function findEntry(entries: unknown[], id: string): ShippedEntry | undefined {
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as ShippedEntry
    if (candidate.id === id) return candidate
    if (Array.isArray(candidate.config)) {
      const nested = findEntry(candidate.config, id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Read and validate one shipped preset's Cordis entry list. */
async function shippedEntries(id: string): Promise<unknown[]> {
  const source = await readFile(join(SHIPPED_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
  const entries: unknown = yaml.load(source, { schema: entryListSchema })
  if (!Array.isArray(entries)) throw new TypeError(`${id} preset must contain a Cordis entry list`)
  return entries.map((entry: unknown) => entry)
}

describe('the shipped preset root', () => {
  it('supplies the built-in presets from a bare roster, healthy and system-trusted', async () => {
    const ctx = await roster({ includeUserRoot: false })

    const listed = await ctx.agentPresets.list()
    // PTC stays on the roster after v0.3.4 retires its new-session pill: the
    // composition, `run_code`, the demo script, and the replay fixtures all
    // still name it. Only the hero row's ordering dropped it. The preview
    // presets join the shipped set as pilot surfaces of the Craft seam, and
    // `army` as the wave-engine composition and `maestro` as the durable lane
    // composition.
    expect(listed.map(preset => preset.id).sort())
      .toEqual(['army', 'cordis', 'instructor', 'maestro', 'pixels-designer', 'ptc', 'standard'])
    expect(listed.every(preset => preset.trust === 'system')).toBe(true)
    // Not `broken === undefined`: health asks whether each row's package is
    // installed above the base, and the shipped rows name packages the
    // deployment installs beside the roster. This fixture base is not that
    // install, so unresolved rows are the only reason it can report here —
    // malformed would be a different one, and this asserts there is none.
    expect(listed.map(preset => preset.broken)
      .filter(reason => reason !== undefined && !reason.includes('cannot be resolved'))).toEqual([])
  })

  it('sanitizes a stored PTC default to standard and reports the substitution', async () => {
    const ctx = await roster({ default: 'ptc', includeUserRoot: false })
    const sanitized: Array<{ from: string; to: string }> = []
    ctx.on('agent-preset/default-sanitized', (payload) => { sanitized.push(payload) })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    // The pill is gone and so is PTC as a new-session default: a deployment or
    // settings document that still stores it composes `standard`, loudly.
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
    expect(sanitized).toEqual([{ from: 'ptc', to: 'standard' }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ptc"'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"standard"'))
  })

  it('keeps PTC explicitly resolvable and readable after its default is sanitized', async () => {
    const ctx = await roster({ default: 'ptc', includeUserRoot: false })
    const sanitized: Array<{ from: string; to: string }> = []
    ctx.on('agent-preset/default-sanitized', (payload) => { sanitized.push(payload) })

    // Only the unnamed-default path substitutes. Settings can still read and
    // mount PTC by id, and a session that explicitly picks it composes it.
    expect((await ctx.agentPresets.resolve('ptc')).id).toBe('ptc')
    expect((await ctx.agentPresets.resolve('ptc')).trust).toBe('system')
    expect((await ctx.agentPresets.readDocument('ptc')).agentPreset).toBe('ptc')
    expect(sanitized).toEqual([])
  })

  it('leaves a stored default that is not the retired preset untouched', async () => {
    const ctx = await roster({ default: 'cordis', includeUserRoot: false })
    const sanitized: Array<{ from: string; to: string }> = []
    ctx.on('agent-preset/default-sanitized', (payload) => { sanitized.push(payload) })

    expect((await ctx.agentPresets.resolve()).id).toBe('cordis')
    expect(sanitized).toEqual([])
  })

  it('leaves a user-authored preset that reuses the retired id alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gnk-preset-custom-ptc-'))
    await mkdir(join(root, 'ptc'))
    await writeFile(join(root, 'ptc', 'agent.cordis.yml'), '- id: alpha\n  name: ./missing.js\n')
    const ctx = await roster({
      default: 'ptc',
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: root, trust: 'user' }],
    })
    const sanitized: Array<{ from: string; to: string }> = []
    ctx.on('agent-preset/default-sanitized', (payload) => { sanitized.push(payload) })

    // Retirement removed the shipped PTC's pill, not the id: a deployment that
    // omits the shipped root and authors its own `ptc` keeps its default.
    expect((await ctx.agentPresets.resolve()).id).toBe('ptc')
    expect(sanitized).toEqual([])
  })

  it('fails loud when a retired default has no standard preset to sanitize to', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gnk-preset-no-standard-'))
    await mkdir(join(root, 'ptc'))
    await writeFile(join(root, 'ptc', 'agent.cordis.yml'), '- id: alpha\n  name: ./missing.js\n')
    const ctx = await roster({
      default: 'ptc',
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: root, trust: 'system' }],
    })

    // Composing the retired default silently would defeat the retirement, and
    // the sanitizer has no substitute to name: report the misconfiguration at
    // the first point the roster can observe it.
    await expect(ctx.agentPresets.resolve()).rejects.toMatchObject({
      code: 'agent-preset/not-found',
      details: { agentPreset: 'standard' },
    })
  })

  it('prepends the shipped root before configured roots and the derived user root', async () => {
    const ctx = await roster({ roots: [{ path: SYSTEM_ROOT, trust: 'user' }] })

    expect(ctx.agentPresets.roots.map(root => root.path)).toEqual([
      SHIPPED_PRESET_ROOT,
      SYSTEM_ROOT,
      expect.stringContaining('.agent-presets'),
    ])
    expect(ctx.agentPresets.roots[0]).toEqual({ path: SHIPPED_PRESET_ROOT, trust: 'system' })
    // Prepended, so a configured directory claiming a shipped id is shadowed:
    // the fixture root also carries `standard`, and the roster serves the
    // shipped one.
    const standard = (await ctx.agentPresets.list()).find(preset => preset.id === 'standard')
    expect(standard?.path.startsWith(SHIPPED_PRESET_ROOT)).toBe(true)
  })

  it('mounts a roster without the shipped set when includeShippedRoot is false', async () => {
    const ctx = await roster({
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: SYSTEM_ROOT, trust: 'system' }],
    })

    expect(ctx.agentPresets.roots).toEqual([{ path: SYSTEM_ROOT, trust: 'system' }])
    const minimal = (await ctx.agentPresets.list()).find(preset => preset.id === 'minimal')
    expect(minimal?.path.startsWith(SYSTEM_ROOT)).toBe(true)
  })

  it('enables web_fetch in each tool-bearing Web app preset', async () => {
    for (const id of ['army', 'cordis', 'instructor', 'maestro', 'pixels-designer', 'ptc', 'standard']) {
      const entries = await shippedEntries(id)
      const toolWeb: unknown = entries.find((entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === 'tool-web')
      if (typeof toolWeb !== 'object' || toolWeb === null || !('config' in toolWeb)
        || typeof toolWeb.config !== 'object' || toolWeb.config === null || !('fetch' in toolWeb.config)) {
        throw new TypeError(`${id} preset must configure tool-web.fetch`)
      }
      expect(toolWeb.config.fetch, id).toBe(true)
    }
  })

  it('omits the general workflow tool only from PTC while retaining Ralph infrastructure', async () => {
    const ptc = await shippedEntries('ptc')
    expect(findEntry(ptc, 'tool-workflow')?.disabled).toBe(true)
    expect(findEntry(ptc, 'workflow-worker-thread')?.disabled).not.toBe(true)
    expect(findEntry(ptc, 'tool-ralph')?.disabled).not.toBe(true)

    for (const id of ['standard', 'cordis']) {
      expect(findEntry(await shippedEntries(id), 'tool-workflow')?.disabled, id).not.toBe(true)
    }
  })
})

import { join, resolve } from 'node:path'
import { Context } from '@greeneek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CraftCatalog, loadPilotCatalog } from '../src/manifest.ts'
import { CraftRuntime } from '../src/service.ts'
import { synthesizeManifest } from '../src/synthesize.ts'
import type { CraftDiscoveredApp, CraftHostProvider } from '../src/types.ts'

const workspace = resolve('workspace')
const GENERATED: CraftDiscoveredApp = {
  id: 'figcraft',
  displayName: 'FigCraft',
  installDir: join(workspace, 'figcraft'),
  version: '1.2.0',
  source: 'launcher-manifest',
}

const TOOLS = [{ name: 'doc_info', description: 'Info', inputSchema: { type: 'object' } }]

function discoveredProvider(
  registry: unknown = { commands: [{ id: 'doc_info', input: { type: 'object' } }] },
): {
  provider: CraftHostProvider
  discover: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  listInstalled: ReturnType<typeof vi.fn>
} {
  const transport = {
    listTools: vi.fn(async () => TOOLS),
    readCommandRegistry: vi.fn(async () => registry),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    close: vi.fn(async () => {}),
  }
  const close = vi.fn(async () => {})
  const discover = vi.fn(async () => ({ state: 'ready' as const, executable: join(workspace, 'figcraft-cli') }))
  const open = vi.fn(async () => ({ transport, close }))
  const listInstalled = vi.fn(async () => [GENERATED])
  const provider: CraftHostProvider = { id: 'fake', discover, open, listInstalled }
  return { provider, discover, open, listInstalled }
}

function mount(provider?: CraftHostProvider): CraftRuntime {
  const ctx = new Context()
  const craft = new CraftRuntime(ctx, {}, loadPilotCatalog())
  if (provider !== undefined) craft.registerProvider(provider)
  return craft
}

describe('synthesizeManifest', () => {
  it('builds a safe ephemeral manifest from launcher facts only', () => {
    const manifest = synthesizeManifest(GENERATED, TOOLS)
    expect(manifest.id).toBe('figcraft')
    expect(manifest.verified).toBe(false)
    expect(manifest.attach.enabled).toBe(false)
    expect(manifest.headless.trustedRegistryHash).toBeNull()
    expect(manifest.headless.toolFilter).toEqual(['doc_info'])
    expect(manifest.platforms).toEqual(['win32', 'linux'])
    expect(() => new CraftCatalog([manifest], () => '# recipe')).not.toThrow()
  })

  it('falls back to a title-cased name, probe filter, and unknown-version floor', () => {
    const manifest = synthesizeManifest({ id: 'webcraft', displayName: '', source: 'os-registry' }, [])
    expect(manifest.displayName).toBe('Webcraft')
    expect(manifest.headless.toolFilter).toEqual(['command_list'])
    expect(manifest.minVersion).toBe('0.0.0')
    const unversioned = synthesizeManifest({ id: 'webcraft', displayName: 'WebCraft', version: 'beta', source: 'os-registry' }, TOOLS)
    expect(unversioned.minVersion).toBe('0.0.0')
    const versioned = synthesizeManifest({ id: 'webcraft', displayName: 'WebCraft', version: '2.0.1', source: 'os-registry' }, TOOLS)
    expect(versioned.minVersion).toBe('2.0.1')
  })
})

describe('discoveredApps', () => {
  it('merges catalog and inventory with per-app status', async () => {
    const fake = discoveredProvider()
    const craft = mount(fake.provider)
    const apps = await craft.discoveredApps()
    expect(apps.map(app => app.app).sort()).toEqual(['figcraft', 'pdfcraft', 'photocraft'])
    expect(apps.find(app => app.app === 'figcraft')).toMatchObject({ state: 'ready', displayName: 'FigCraft' })
    await craft.closeAll()
  })

  it('skips inventory entries that duplicate a catalog id', async () => {
    const transport = {
      listTools: vi.fn(async () => TOOLS),
      readCommandRegistry: vi.fn(async () => ({})),
      callTool: vi.fn(async () => ({ content: [] })),
      close: vi.fn(async () => {}),
    }
    const provider: CraftHostProvider = {
      id: 'plain',
      discover: vi.fn(async () => ({ state: 'ready' as const })),
      open: vi.fn(async () => ({ transport, close: vi.fn(async () => {}) })),
      listInstalled: vi.fn(async () => [{ id: 'photocraft', displayName: 'PhotoCraft', source: 'launcher-manifest' as const }]),
    }
    const craft = mount(provider)
    const apps = await craft.discoveredApps()
    expect(apps.map(app => app.app)).toEqual(['photocraft', 'pdfcraft'])
    expect(craft.findApp('photocraft')?.id).toBe('photocraft')
    expect(craft.findApp('gimp')).toBeUndefined()
    expect(craft.observedCapabilityHash('photocraft')).toBeUndefined()
    expect(craft.observedCapabilityHash('gimp')).toBeUndefined()
    await craft.closeAll()
  })

  it('falls back to the catalog when inventory fails', async () => {
    const transport = {
      listTools: vi.fn(async () => TOOLS),
      readCommandRegistry: vi.fn(async () => ({})),
      callTool: vi.fn(async () => ({ content: [] })),
      close: vi.fn(async () => {}),
    }
    const provider: CraftHostProvider = {
      id: 'plain',
      discover: vi.fn(async () => ({ state: 'ready' as const })),
      open: vi.fn(async () => ({ transport, close: vi.fn(async () => {}) })),
      listInstalled: vi.fn(async () => { throw new Error('inventory exploded') }),
    }
    const craft = mount(provider)
    const apps = await craft.discoveredApps()
    expect(apps.map(app => app.app)).toEqual(['photocraft', 'pdfcraft'])
    await craft.closeAll()
  })

  it('falls back to the catalog when the provider has no inventory', async () => {
    const transport = {
      listTools: vi.fn(async () => TOOLS),
      readCommandRegistry: vi.fn(async () => ({})),
      callTool: vi.fn(async () => ({ content: [] })),
      close: vi.fn(async () => {}),
    }
    const provider: CraftHostProvider = {
      id: 'plain',
      discover: vi.fn(async () => ({ state: 'ready' as const })),
      open: vi.fn(async () => ({ transport, close: vi.fn(async () => {}) })),
    }
    const craft = mount(provider)
    const apps = await craft.discoveredApps()
    expect(apps.map(app => app.app)).toEqual(['photocraft', 'pdfcraft'])
    await craft.closeAll()
  })
})

describe('open discovered app', () => {
  it('opens an auto-detected app with an observed tool filter', async () => {
    const fake = discoveredProvider()
    const craft = mount(fake.provider)
    const session = await craft.open({ app: 'figcraft', workspaceRoot: workspace })
    expect(session.tools).toEqual(TOOLS)
    expect(session.registryReviewed).toBe(false)
    expect(session.manifest?.headless.toolFilter).toEqual(['doc_info'])
    expect(session.manifest?.attach.enabled).toBe(false)
    await session.close()
  })

  it('marks a drifted registry unverified and blocks reopening', async () => {
    let registry: unknown = { commands: [{ id: 'doc_info' }] }
    let tools = [{ name: 'doc_info', description: 'Info', inputSchema: { type: 'object' } }]
    const transport = {
      listTools: vi.fn(async () => tools),
      readCommandRegistry: vi.fn(async () => registry),
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      close: vi.fn(async () => {}),
    }
    const provider: CraftHostProvider = {
      id: 'fake',
      discover: vi.fn(async () => ({ state: 'ready' as const })),
      open: vi.fn(async () => ({ transport, close: vi.fn(async () => {}) })),
      listInstalled: vi.fn(async () => [GENERATED]),
    }
    const craft = mount(provider)
    const seeded = await craft.open({ app: 'figcraft', workspaceRoot: workspace })
    await seeded.close()
    registry = { commands: [{ id: 'changed' }] }
    tools = [{ name: 'changed', description: 'Changed', inputSchema: { type: 'object' } }]
    await expect(craft.open({ app: 'figcraft', workspaceRoot: workspace })).rejects.toMatchObject({
      code: 'CRAFT_APP_NOT_READY',
    })
    const status = await craft.status('figcraft')
    expect(status.state).toBe('drifted')
    await craft.closeAll()
  })

  it('drift-hashes a registry-method manifest without a trusted baseline', async () => {
    const { parseManifest } = await import('../src/manifest.ts')
    const base = loadPilotCatalog().require('photocraft')
    let registry: unknown = { commands: [{ id: 'doc_info' }] }
    const transport = {
      listTools: vi.fn(async () => [{ name: 'doc_info', description: '', inputSchema: { type: 'object' } }]),
      readCommandRegistry: vi.fn(async () => registry),
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      close: vi.fn(async () => {}),
    }
    const provider: CraftHostProvider = {
      id: 'fake',
      discover: vi.fn(async () => ({ state: 'ready' as const })),
      open: vi.fn(async () => ({ transport, close: vi.fn(async () => {}) })),
    }
    const manifest = parseManifest({
      ...base,
      headless: { ...base.headless, registryMethod: 'engine.commands', trustedRegistryHash: null },
    })
    const craft = new CraftRuntime(new Context(), {}, new CraftCatalog([manifest]))
    craft.registerProvider(provider)
    const seeded = await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    expect(craft.observedCapabilityHash('photocraft')).toBeDefined()
    await seeded.close()
    registry = { commands: [{ id: 'changed' }] }
    await expect(craft.open({ app: 'photocraft', workspaceRoot: workspace })).rejects.toMatchObject({
      code: 'CRAFT_APP_NOT_READY',
    })
    expect((await craft.status('photocraft')).state).toBe('drifted')
    await craft.closeAll()
  })

  it('still rejects an unknown app without inventing one', async () => {
    const fake = discoveredProvider()
    const craft = mount(fake.provider)
    await expect(craft.open({ app: 'gimp', workspaceRoot: workspace })).rejects.toMatchObject({
      code: 'CRAFT_APP_NOT_IN_PILOT',
    })
    await craft.closeAll()
  })

  it('rejects an unknown app when the provider has no inventory', async () => {
    const transport = {
      listTools: vi.fn(async () => TOOLS),
      readCommandRegistry: vi.fn(async () => ({})),
      callTool: vi.fn(async () => ({ content: [] })),
      close: vi.fn(async () => {}),
    }
    const provider: CraftHostProvider = {
      id: 'plain',
      discover: vi.fn(async () => ({ state: 'ready' as const })),
      open: vi.fn(async () => ({ transport, close: vi.fn(async () => {}) })),
    }
    const craft = mount(provider)
    await expect(craft.open({ app: 'gimp', workspaceRoot: workspace })).rejects.toMatchObject({
      code: 'CRAFT_APP_NOT_IN_PILOT',
    })
    await craft.closeAll()
  })
})

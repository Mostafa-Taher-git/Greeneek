import { join, resolve } from 'node:path'
import { Context } from '@greeneek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CraftCatalog, loadPilotCatalog, parseManifest } from '../src/manifest.ts'
import { CraftRuntime } from '../src/service.ts'
import { hashCommandRegistry } from '../src/registry.ts'
import type {
  CraftCallResult,
  CraftDiscovery,
  CraftHostProvider,
  CraftRuntimeConfig,
  CraftToolDescriptor,
  CraftTransport,
} from '../src/types.ts'

const workspace = resolve('workspace')

const TOOL: CraftToolDescriptor = {
  name: 'command_list',
  description: 'list commands',
  inputSchema: { type: 'object' },
}

const RESULT: CraftCallResult = { content: [{ type: 'text', text: 'ok' }] }
const REGISTRY = { commands: [{ id: 'convert', input: { type: 'object' } }] }

interface FakeProvider {
  provider: CraftHostProvider
  discover: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  transport: CraftTransport & {
    listTools: ReturnType<typeof vi.fn>
    readCommandRegistry: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  close: ReturnType<typeof vi.fn>
}

function fakeProvider(
  discovery: CraftDiscovery = { state: 'ready', executable: join(workspace, 'photocraft-cli') },
  options: {
    readonly closeRejects?: boolean
    readonly tools?: readonly CraftToolDescriptor[]
    readonly registry?: unknown
  } = {},
): FakeProvider {
  const transport = {
    listTools: vi.fn(async () => options.tools ?? [TOOL]),
    readCommandRegistry: vi.fn(async () => options.registry ?? REGISTRY),
    callTool: vi.fn(async () => RESULT),
    close: vi.fn(async () => {}),
  }
  const close = vi.fn(async () => {
    if (options.closeRejects === true) throw new Error('close failed')
  })
  const discover = vi.fn(async () => discovery)
  const open = vi.fn(async () => ({ transport, close }))
  const provider: CraftHostProvider = { id: 'fake', discover, open }
  return { provider, discover, open, transport, close }
}

function trustedPhotoCatalog(registry: unknown): CraftCatalog {
  const base = loadPilotCatalog().require('photocraft')
  return new CraftCatalog([parseManifest({
    ...base,
    headless: {
      ...base.headless,
      registryMethod: 'engine.commands',
      trustedRegistryHash: hashCommandRegistry(registry),
    },
  })])
}

function mount(
  config: CraftRuntimeConfig = {},
  catalog: CraftCatalog = loadPilotCatalog(),
): { ctx: Context; craft: CraftRuntime } {
  const ctx = new Context()
  const craft = new CraftRuntime(ctx, config, catalog)
  return { ctx, craft }
}

describe('catalog surface', () => {
  it('lists the pilot, resolves aliases, and reports attach disabled', () => {
    const { craft } = mount()
    expect(craft.listApps().map(app => app.id)).toEqual(['photocraft', 'pdfcraft'])
    expect(craft.app('printcraft').id).toBe('pdfcraft')
    expect(craft.attachEnabled('photocraft')).toBe(false)
    expect(craft.recipe('photocraft').name).toBe('craft-photocraft')
    expect(() => craft.app('figcraft')).toThrow(expect.objectContaining({ code: 'CRAFT_APP_NOT_IN_PILOT' }))
  })

  it('publishes attach only when both supported and enabled', () => {
    const base = loadPilotCatalog().require('photocraft')
    const enabled = parseManifest({ ...base, attach: { supported: true, enabled: true, reason: 'test' } })
    const disabled = parseManifest({
      ...base,
      id: 'othercraft',
      aliases: [],
      attach: { supported: true, enabled: false, reason: 'test' },
    })
    const { craft } = mount({}, new CraftCatalog([enabled, disabled]))
    expect(craft.attachEnabled('photocraft')).toBe(true)
    expect(craft.attachEnabled('othercraft')).toBe(false)
    expect(craft.attachEnabled(enabled)).toBe(true)
  })
})

describe('provider selection', () => {
  it('registers, unregisters, and rejects duplicates', () => {
    const { craft } = mount()
    const first = fakeProvider()
    const dispose = craft.registerProvider(first.provider)
    expect(() => craft.registerProvider(fakeProvider().provider))
      .toThrow(expect.objectContaining({ code: 'CRAFT_PROVIDER_AMBIGUOUS' }))
    dispose()
    expect(() => craft.registerProvider(fakeProvider().provider)).not.toThrow()
  })

  it('keeps a replacement provider when the displaced one is disposed again', () => {
    const { craft } = mount()
    const dispose = craft.registerProvider(fakeProvider().provider)
    dispose()
    craft.registerProvider(fakeProvider().provider)
    dispose()
    expect(() => craft.registerProvider(fakeProvider().provider))
      .toThrow(expect.objectContaining({ code: 'CRAFT_PROVIDER_AMBIGUOUS' }))
  })

  it('fails with NO_PROVIDER when none is registered', async () => {
    const { craft } = mount()
    await expect(craft.status('photocraft')).rejects
      .toThrow(expect.objectContaining({ code: 'CRAFT_NO_PROVIDER' }))
    await expect(craft.open({ app: 'photocraft', workspaceRoot: workspace })).rejects
      .toThrow(expect.objectContaining({ code: 'CRAFT_NO_PROVIDER' }))
  })

  it('fails ambiguous selection and honors a pinned provider', async () => {
    const { craft } = mount()
    craft.registerProvider(fakeProvider().provider)
    const second = fakeProvider({ state: 'not-installed' })
    craft.registerProvider({ ...second.provider, id: 'second' })
    await expect(craft.status('photocraft')).rejects
      .toThrow(expect.objectContaining({ code: 'CRAFT_PROVIDER_AMBIGUOUS' }))

    const pinned = mount({ provider: 'second' })
    pinned.craft.registerProvider(fakeProvider().provider)
    pinned.craft.registerProvider({ ...second.provider, id: 'second' })
    await expect(pinned.craft.status('photocraft')).resolves.toMatchObject({ state: 'not-installed' })

    const missing = mount({ provider: 'absent' })
    await expect(missing.craft.status('photocraft')).rejects
      .toThrow(expect.objectContaining({ code: 'CRAFT_NO_PROVIDER' }))
  })
})

describe('status', () => {
  it.each([
    'not-installed',
    'app-installed-cli-missing',
    'unsupported-version',
    'ready',
    'drifted',
  ] as const)('publishes %s from discovery', async (state) => {
    const { craft } = mount()
    craft.registerProvider(fakeProvider({ state, detail: `detail:${state}` }).provider)
    const status = await craft.status('photocraft')
    expect(status).toMatchObject({ app: 'photocraft', displayName: 'PhotoCraft', state, detail: `detail:${state}` })
  })

  it('reports running without re-running discovery while a session is live', async () => {
    const { craft } = mount()
    const fake = fakeProvider()
    craft.registerProvider(fake.provider)
    const session = await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    expect(await craft.status('photocraft')).toMatchObject({ state: 'running' })
    expect(fake.discover).not.toHaveBeenCalled()
    await session.close()
    expect(await craft.status('photocraft')).toMatchObject({ state: 'ready' })
    expect(fake.discover).toHaveBeenCalledTimes(1)
  })

  it.each([
    { thrown: new Error('registry exploded'), detail: 'registry exploded' },
    { thrown: 'registry exploded', detail: 'registry exploded' },
  ])('reports discovery failures as failed and forwards the caller signal', async ({ thrown, detail }) => {
    const { craft } = mount()
    const fake = fakeProvider()
    fake.discover.mockRejectedValue(thrown)
    craft.registerProvider(fake.provider)
    const controller = new AbortController()
    await expect(craft.status('photocraft', controller.signal)).resolves.toMatchObject({ state: 'failed', detail })
    expect(fake.discover).toHaveBeenCalledWith(expect.anything(), { signal: controller.signal })
  })

  it('preserves cancellation instead of publishing a failed status', async () => {
    const { craft } = mount()
    const fake = fakeProvider()
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)
    fake.discover.mockRejectedValue(reason)
    craft.registerProvider(fake.provider)
    await expect(craft.status('photocraft', controller.signal)).rejects.toBe(reason)
    expect(fake.discover).toHaveBeenCalledWith(expect.anything(), { signal: controller.signal })
  })
})

describe('open', () => {
  it('keeps a running session scoped to its own app', async () => {
    const { craft } = mount()
    craft.registerProvider(fakeProvider().provider)
    await craft.open({ app: 'pdfcraft', workspaceRoot: workspace })

    expect(await craft.status('photocraft')).toMatchObject({ state: 'ready' })
    await expect(craft.status('pdfcraft')).resolves.toMatchObject({ state: 'running' })
  })

  it('opens one headless session with confined roots and a control token', async () => {
    const { craft } = mount()
    const fake = fakeProvider()
    craft.registerProvider(fake.provider)
    const session = await craft.open({ app: 'printcraft', workspaceRoot: workspace })
    expect(session).toMatchObject({
      app: 'pdfcraft',
      mode: 'headless',
      roots: { read: workspace, write: join(workspace, 'out') },
      tools: [TOOL],
    })
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.open).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: workspace,
      roots: { read: workspace, write: join(workspace, 'out') },
      controlToken: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string,
    }))
    expect(session.transport).toBe(fake.transport)
    expect(session.registryReviewed).toBe(false)
    expect(fake.transport.readCommandRegistry).not.toHaveBeenCalled()
    await session.close()
    expect(fake.close).toHaveBeenCalledTimes(1)
    expect(await craft.status('pdfcraft')).toMatchObject({ state: 'ready' })
  })

  it('marks a matching reviewed registry and recovers to ready after close', async () => {
    const { craft } = mount({}, trustedPhotoCatalog(REGISTRY))
    const fake = fakeProvider()
    craft.registerProvider(fake.provider)

    await expect(craft.status('photocraft')).resolves.toMatchObject({ state: 'ready' })
    const session = await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    expect(session.registryReviewed).toBe(true)
    expect(fake.transport.readCommandRegistry).toHaveBeenCalledTimes(1)
    await session.close()
    await expect(craft.status('photocraft')).resolves.toMatchObject({ state: 'ready' })
  })

  it('rejects a drifted registry, closes the host, and reports the retained observation', async () => {
    const drifted = { commands: [{ id: 'changed', input: { type: 'object' } }] }
    const { craft } = mount({}, trustedPhotoCatalog(REGISTRY))
    const fake = fakeProvider(undefined, { registry: drifted })
    craft.registerProvider(fake.provider)

    await expect(craft.open({ app: 'photocraft', workspaceRoot: workspace })).rejects.toMatchObject({
      code: 'CRAFT_APP_NOT_READY',
      message: expect.stringContaining(hashCommandRegistry(drifted)) as unknown as string,
    })
    expect(fake.close).toHaveBeenCalledTimes(1)
    expect(fake.transport.listTools).not.toHaveBeenCalled()
    const status = await craft.status('photocraft')
    expect(status.state).toBe('drifted')
    expect(status.executable).toBeDefined()
    expect(status.detail).toContain(hashCommandRegistry(REGISTRY))
    expect(status.detail).toContain(hashCommandRegistry(drifted))
    expect(fake.open).toHaveBeenCalledTimes(1)
  })

  it('allows a later open to prove that a drifted registry was restored', async () => {
    const { craft } = mount({}, trustedPhotoCatalog(REGISTRY))
    const fake = fakeProvider(undefined, { registry: REGISTRY })
    fake.transport.readCommandRegistry.mockResolvedValueOnce({ commands: [{ id: 'changed' }] })
    craft.registerProvider(fake.provider)

    await expect(craft.open({ app: 'photocraft', workspaceRoot: workspace })).rejects.toMatchObject({ code: 'CRAFT_APP_NOT_READY' })
    const restored = await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    expect(restored.registryReviewed).toBe(true)
    await restored.close()
    await expect(craft.status('photocraft')).resolves.toMatchObject({ state: 'ready' })
  })

  it('is idempotent on close and exposes closeSession', async () => {
    const { craft } = mount()
    const fake = fakeProvider()
    craft.registerProvider(fake.provider)
    const session = await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    await craft.closeSession(session.id)
    await session.close()
    expect(fake.close).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown sessions', async () => {
    const { craft } = mount()
    await expect(craft.closeSession('missing'))
      .rejects.toThrow(expect.objectContaining({ code: 'CRAFT_SESSION_UNKNOWN' }))
  })

  it('gates attach mode twice: disabled manifests and unpublished live attach', async () => {
    const { craft } = mount()
    const disabled = fakeProvider()
    craft.registerProvider(disabled.provider)
    await expect(craft.open({ app: 'photocraft', mode: 'attach', workspaceRoot: workspace }))
      .rejects.toThrow(expect.objectContaining({
        code: 'CRAFT_ATTACH_DISABLED',
        message: expect.stringContaining('Live attach has no authenticated channel') as unknown as string,
      }))
    expect(disabled.open).not.toHaveBeenCalled()

    const base = loadPilotCatalog().require('photocraft')
    const enabled = parseManifest({ ...base, attach: { supported: true, enabled: true, reason: 'test' } })
    const attachable = mount({}, new CraftCatalog([enabled]))
    const unpublished = fakeProvider()
    attachable.craft.registerProvider(unpublished.provider)
    await expect(attachable.craft.open({ app: 'photocraft', mode: 'attach', workspaceRoot: workspace }))
      .rejects.toThrow(expect.objectContaining({
        code: 'CRAFT_ATTACH_DISABLED',
        message: expect.stringContaining('not implemented') as unknown as string,
      }))
    expect(unpublished.open).not.toHaveBeenCalled()
  })

  it('rejects headless-unsupported apps and relative workspace roots', async () => {
    const base = loadPilotCatalog().require('photocraft')
    const unsupported = parseManifest({ ...base, headlessSupported: false })
    const { craft } = mount({}, new CraftCatalog([unsupported]))
    craft.registerProvider(fakeProvider().provider)
    await expect(craft.open({ app: 'photocraft', workspaceRoot: workspace }))
      .rejects.toThrow(expect.objectContaining({ code: 'CRAFT_HEADLESS_UNSUPPORTED' }))

    const pilot = mount()
    pilot.craft.registerProvider(fakeProvider().provider)
    await expect(pilot.craft.open({ app: 'photocraft', workspaceRoot: 'relative' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CRAFT_ROOT_INVALID' }))
  })

  it('enforces the concurrency cap and frees a slot on close', async () => {
    const { craft } = mount({ maxActiveApps: 1 })
    craft.registerProvider(fakeProvider().provider)
    const first = await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    await expect(craft.open({ app: 'pdfcraft', workspaceRoot: workspace }))
      .rejects.toThrow(expect.objectContaining({ code: 'CRAFT_LIMIT_REACHED' }))
    await first.close()
    await expect(craft.open({ app: 'pdfcraft', workspaceRoot: workspace })).resolves.toMatchObject({ app: 'pdfcraft' })
  })

  it('closes the host when discovery fails or the caller already aborted', async () => {
    const { craft } = mount()
    const failing = fakeProvider()
    failing.transport.listTools.mockRejectedValueOnce(new Error('catalog failed'))
    craft.registerProvider(failing.provider)
    await expect(craft.open({ app: 'photocraft', workspaceRoot: workspace })).rejects.toThrow('catalog failed')
    expect(failing.close).toHaveBeenCalledTimes(1)

    const aborted = mount()
    const abortedProvider = fakeProvider()
    aborted.craft.registerProvider(abortedProvider.provider)
    const controller = new AbortController()
    controller.abort()
    await expect(aborted.craft.open({ app: 'photocraft', workspaceRoot: workspace, signal: controller.signal }))
      .rejects.toThrow()
    expect(abortedProvider.close).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-positive provider configuration', () => {
    expect(() => mount({ maxActiveApps: 0 }))
      .toThrow(expect.objectContaining({ code: 'CRAFT_LIMIT_REACHED' }))
    expect(() => mount({ maxActiveApps: 1.5 }))
      .toThrow(expect.objectContaining({ code: 'CRAFT_LIMIT_REACHED' }))
  })
})

describe('teardown', () => {
  it('closes every session and contains failures', async () => {
    const { craft } = mount({ maxActiveApps: 2 })
    const good = fakeProvider()
    const bad = fakeProvider(undefined, { closeRejects: true })
    craft.registerProvider(good.provider)
    await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    await craft.open({ app: 'pdfcraft', workspaceRoot: workspace })
    await craft.closeAll()
    expect(good.close).toHaveBeenCalledTimes(2)

    // A rejecting close is contained and logged.
    const second = mount()
    second.craft.registerProvider(bad.provider)
    await second.craft.open({ app: 'photocraft', workspaceRoot: workspace })
    await expect(second.craft.closeAll()).resolves.toBeUndefined()

    // Fiber disposal also drains live sessions.
    const third = mount()
    const thirdProvider = fakeProvider()
    third.craft.registerProvider(thirdProvider.provider)
    await third.craft.open({ app: 'photocraft', workspaceRoot: workspace })
    await third.ctx.fiber.dispose()
    await vi.waitFor(() => { expect(thirdProvider.close).toHaveBeenCalledTimes(1) })
  })

  it('contains a teardown failure raised from a disposal path', async () => {
    const { ctx, craft } = mount()
    const bad = fakeProvider(undefined, { closeRejects: true })
    craft.registerProvider(bad.provider)
    await craft.open({ app: 'photocraft', workspaceRoot: workspace })
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })
})

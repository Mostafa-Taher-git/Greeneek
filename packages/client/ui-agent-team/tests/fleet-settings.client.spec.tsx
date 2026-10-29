// @vitest-environment jsdom
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import type { FleetFavorite, FleetProviderAvailability } from '@greeneek/gnk-agent-team/client'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { RemoteError } from '@greeneek/gnk-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeFleetSettings, errorText, FleetSettingsSection, type FleetSettingsInjected, type FleetSettingsSectionProps, type FleetSnapshot,
} from '../src/client/FleetSettingsSection.tsx'
import { ar, en, NS, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const FAVORITE: FleetFavorite = {
  id: 'review-fleet',
  name: 'Review fleet',
  members: [{
    name: 'reviewer',
    description: 'review',
    prompt: 'review the diff',
    provider: 'spawn',
    model: 'mock',
    reasoningEffort: 'high',
    maxTokens: 4_000,
    readOnly: true,
  }],
}

const PROVIDERS: FleetProviderAvailability[] = [
  { name: 'spawn', state: 'ready', continuable: true },
  {
    name: 'claude-code',
    state: 'not-installed',
    continuable: false,
    detail: 'provider is not registered in this composition',
  },
]

/** Locale translator for the shipped dictionaries. */
function translator(localeId: 'en' | 'ar'): { t: (key: string, params?: Record<string, unknown>) => string; close: () => void } {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  locale.register(NS, { zh, en, ar })
  locale.setLocale(localeId)
  return { t: locale.bind(NS) as never, close: () => undefined }
}

/** Render the section with one mutable favorites snapshot. */
function setup(localeId: 'en' | 'ar' = 'en', options: {
  readonly status?: FleetSnapshot['status']
  readonly writable?: boolean
  readonly availabilityFailure?: boolean
  readonly canLaunch?: boolean
  readonly providers?: readonly FleetProviderAvailability[]
  readonly favorites?: readonly FleetFavorite[]
  readonly emptySnapshot?: boolean
  readonly saveFailure?: unknown
  readonly launch?: () => Promise<unknown>
} = {}) {
  let favorites: FleetFavorite[] = [...(options.favorites ?? [FAVORITE])]
  let snapshot: FleetSnapshot = {
    status: options.status ?? 'ready',
    value: options.emptySnapshot === true ? undefined : { favorites },
    revision: 1,
    writable: options.writable ?? true,
  }
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const listener of listeners) listener() }
  const save = vi.fn(async (next: readonly FleetFavorite[]) => {
    if (options.saveFailure !== undefined) throw options.saveFailure
    favorites = [...next]
    snapshot = { ...snapshot, value: { favorites }, revision: (snapshot.revision ?? 0) + 1 }
    emit()
  })
  const launch = vi.fn((options.launch ?? (async () => ({
    ok: true as const,
    value: { ok: true as const, value: { members: [] } },
  }))) as never)
  const injected: FleetSettingsInjected = {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    loadAvailability: async () => (options.availabilityFailure === true
      ? { ok: false as const, error: new RemoteError('gateway/internal', 'availability unavailable', {}) }
      : { ok: true as const, value: options.providers ?? PROVIDERS }),
    save,
    launch,
    canLaunch: () => options.canLaunch ?? true,
  } as unknown as FleetSettingsInjected
  const { t, close } = translator(localeId)
  const props = { t: t as never, close, ...injected } as unknown as FleetSettingsSectionProps
  const view = render(<FleetSettingsSection {...props} />)
  return { view, save, launch, t }
}

const SCOPED: FleetFavorite = {
  id: 'scoped',
  name: 'Scoped fleet',
  members: [
    { name: 'shared', description: 'shared', prompt: 'share', provider: 'spawn' },
    { name: 'scoped', description: 'scoped', prompt: 'scope', provider: 'spawn', writeScopes: ['src', 'docs'] },
  ],
}

describe('fleet settings section', () => {
  it('renders provider availability and each saved favorite', async () => {
    const { view } = setup()

    expect(await view.findByText('Provider availability')).toBeDefined()
    expect((await view.findAllByText('spawn')).length).toBeGreaterThan(0)
    expect(await view.findByText('Not installed')).toBeDefined()
    expect(await view.findByText('Review fleet')).toBeDefined()
    expect(await view.findByText('1 member(s)')).toBeDefined()
  })

  it('echoes each member before launch and starts nothing on cancel', async () => {
    const { view, launch } = setup()
    fireEvent.click(await view.findByRole('button', { name: 'Launch' }))

    const dialog = await view.findByRole('alertdialog', { name: 'Confirm fleet launch' })
    expect(dialog.textContent).toContain('reviewer: spawn')
    expect(dialog.textContent).toContain('mock')
    expect(dialog.textContent).toContain('high')
    expect(dialog.textContent).toContain('4000 tokens')
    expect(dialog.textContent).toContain('Read-only')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(launch).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    fireEvent.click(view.getByRole('button', { name: 'Confirm launch' }))
    expect(launch).toHaveBeenCalledWith('review-fleet')
    expect(await view.findByText('Started 0 member(s).')).toBeDefined()
  })

  it('creates a fleet through the member editor and derives its id', async () => {
    const { view, save } = setup()
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    fireEvent.change(view.getByLabelText(/Fleet id/u), { target: { value: 'my-fleet' } })
    fireEvent.click(view.getByRole('button', { name: 'Add member' }))
    expect(view.getAllByRole('button', { name: 'Remove member' })).toHaveLength(2)
    fireEvent.change(view.getAllByLabelText('Member name')[0]!, { target: { value: 'worker' } })
    fireEvent.click(view.getAllByRole('button', { name: 'Remove member' })[1]!)
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(view.queryByText('Edit fleet')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    fireEvent.change(view.getByLabelText('Fleet name'), { target: { value: 'My Fleet' } })
    fireEvent.change(view.getByLabelText('Member name'), { target: { value: 'worker' } })
    fireEvent.change(view.getByLabelText('Responsibility'), { target: { value: 'do work' } })
    fireEvent.change(view.getByLabelText('Initial task'), { target: { value: 'start' } })
    fireEvent.change(view.getByLabelText('Provider'), { target: { value: 'spawn' } })
    fireEvent.change(view.getByLabelText('Context'), { target: { value: 'fork' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: 'reviewing' } })
    fireEvent.change(view.getByLabelText('Model'), { target: { value: 'mock' } })
    fireEvent.change(view.getByLabelText('Reasoning effort'), { target: { value: 'high' } })
    fireEvent.change(view.getByLabelText('Token ceiling'), { target: { value: '2000' } })
    fireEvent.click(view.getByLabelText('Read-only'))
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    const saved = save.mock.calls[0]![0] as FleetFavorite[]
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({
      id: 'my-fleet',
      name: 'My Fleet',
      members: [{
        name: 'worker',
        provider: 'spawn',
        context: 'fork',
        preset: 'reviewing',
        model: 'mock',
        reasoningEffort: 'high',
        maxTokens: 2_000,
        readOnly: true,
      }],
    })
  })

  it('edits a favorite, including clearing optional fields and write scopes', async () => {
    const { view, save } = setup()
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    expect((view.getByLabelText('Fleet name') as HTMLInputElement).value).toBe('Review fleet')
    const readOnly = view.getByLabelText('Read-only') as HTMLInputElement
    expect(readOnly.checked).toBe(true)
    fireEvent.click(readOnly)
    fireEvent.change(view.getByLabelText(/Write scopes/u), {
      target: { value: 'src, ./docs/, src' },
    })
    fireEvent.change(view.getByLabelText(/Write scopes/u), { target: { value: '' } })
    fireEvent.change(view.getByLabelText(/Write scopes/u), { target: { value: 'src, ./docs/' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText('Model'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText('Reasoning effort'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText('Token ceiling'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText(/Fleet id/u), { target: { value: 'review-fleet' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    const saved = (save.mock.calls[0]![0] as FleetFavorite[])[0]!
    expect(saved.members[0]).toMatchObject({
      name: 'reviewer',
      writeScopes: ['src', './docs/'],
    })
    expect(saved.members[0]?.readOnly).toBeUndefined()
    expect(saved.members[0]?.model).toBeUndefined()
    expect(saved.members[0]?.reasoningEffort).toBeUndefined()
    expect(saved.members[0]?.maxTokens).toBeUndefined()

    await vi.waitFor(() => {
      expect(view.getByRole('button', { name: 'Launch' }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    const dialog = view.getByRole('alertdialog')
    expect(dialog.textContent).toContain('scopes src, ./docs/')
  })

  it('echoes shared, inherited, and scoped members before launch', async () => {
    const { view, save } = setup('en', { favorites: [FAVORITE, SCOPED] })
    await view.findByText('Scoped fleet')
    fireEvent.click(view.getAllByRole('button', { name: 'Edit' })[0]!)
    fireEvent.change(view.getByLabelText('Fleet name'), { target: { value: 'Review renamed' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: 'reviewing' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    expect((save.mock.calls.at(-1)?.[0] as FleetFavorite[]).map(candidate => candidate.id))
      .toEqual(['review-fleet', 'scoped'])
    await vi.waitFor(() => {
      expect(view.getAllByRole('button', { name: 'Launch' })[1]!.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(view.getAllByRole('button', { name: 'Launch' })[1]!)
    const dialog = view.getByRole('alertdialog')
    expect(dialog.textContent).toContain('shared: spawn, inherited, inherited, inherited, unbounded, shared checkout')
    expect(dialog.textContent).toContain('scoped: spawn')
    expect(dialog.textContent).toContain('scopes src, docs')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
  })

  it('clears and restores the optional preset field', async () => {
    const { view, save } = setup()
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    fireEvent.change(view.getByLabelText('Fleet name'), { target: { value: 'Preset fleet' } })
    fireEvent.change(view.getByLabelText('Member name'), { target: { value: 'worker' } })
    fireEvent.change(view.getByLabelText('Responsibility'), { target: { value: 'work' } })
    fireEvent.change(view.getByLabelText('Initial task'), { target: { value: 'go' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: 'first' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText('Preset'), { target: { value: 'second' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    const saved = save.mock.calls[0]![0] as FleetFavorite[]
    expect(saved.find(candidate => candidate.id === 'preset-fleet')?.members[0]?.preset).toBe('second')
  })

  it('decodes only a fleet-shaped settings section', () => {
    expect(decodeFleetSettings({ favorites: [] })).toEqual({ favorites: [] })
    expect(decodeFleetSettings(null)).toBeUndefined()
    expect(decodeFleetSettings({})).toBeUndefined()
    expect(decodeFleetSettings({ favorites: 'wrong' })).toBeUndefined()
    expect(errorText(new Error('message'))).toBe('message')
    expect(errorText('plain')).toBe('plain')
  })

  it('contains save, launch, and availability failures', async () => {
    const failingSave = setup('en', { saveFailure: new Error('store denied') })
    fireEvent.click(await failingSave.view.findByRole('button', { name: 'Delete' }))
    expect(await failingSave.view.findByText('Action failed: store denied')).toBeDefined()

    cleanup()
    const stringSave = setup('en', { saveFailure: 'string denial' })
    fireEvent.click(await stringSave.view.findByRole('button', { name: 'Delete' }))
    expect(await stringSave.view.findByText('Action failed: string denial')).toBeDefined()
    fireEvent.click(stringSave.view.getByRole('button', { name: 'New fleet' }))
    fireEvent.change(stringSave.view.getByLabelText('Fleet name'), { target: { value: 'Broken' } })
    fireEvent.change(stringSave.view.getByLabelText('Member name'), { target: { value: 'worker' } })
    fireEvent.change(stringSave.view.getByLabelText('Responsibility'), { target: { value: 'work' } })
    fireEvent.change(stringSave.view.getByLabelText('Initial task'), { target: { value: 'go' } })
    fireEvent.click(stringSave.view.getByRole('button', { name: 'Save' }))
    expect(await stringSave.view.findByText('Action failed: string denial')).toBeDefined()

    cleanup()
    const businessFailure = setup('en', {
      launch: async () => ({
        ok: true,
        value: { ok: false, error: { code: 'TEAM_FLEET_PROVIDER_UNAVAILABLE', message: 'provider gone' } },
      }),
    })
    await businessFailure.view.findByText('Review fleet')
    fireEvent.click(businessFailure.view.getByRole('button', { name: 'Launch' }))
    fireEvent.click(businessFailure.view.getByRole('button', { name: 'Confirm launch' }))
    expect(await businessFailure.view.findByText('Action failed: provider gone')).toBeDefined()

    cleanup()
    const remoteFailure = setup('en', {
      launch: async () => ({ ok: false, error: new RemoteError('gateway/internal', 'offline', {}) }),
    })
    await remoteFailure.view.findByText('Review fleet')
    fireEvent.click(remoteFailure.view.getByRole('button', { name: 'Launch' }))
    fireEvent.click(remoteFailure.view.getByRole('button', { name: 'Confirm launch' }))
    expect(await remoteFailure.view.findByText('Action failed: offline')).toBeDefined()

    cleanup()
    const stringLaunch = setup('en', { launch: async () => { throw 'string failure' } })
    await stringLaunch.view.findByText('Review fleet')
    fireEvent.click(stringLaunch.view.getByRole('button', { name: 'Launch' }))
    fireEvent.click(stringLaunch.view.getByRole('button', { name: 'Confirm launch' }))
    expect(await stringLaunch.view.findByText('Action failed: string failure')).toBeDefined()

    cleanup()
    const thrown = setup('en', { launch: async () => { throw new Error('network down') } })
    await thrown.view.findByText('Review fleet')
    fireEvent.click(thrown.view.getByRole('button', { name: 'Launch' }))
    fireEvent.click(thrown.view.getByRole('button', { name: 'Confirm launch' }))
    expect(await thrown.view.findByText('Action failed: network down')).toBeDefined()

    cleanup()
    const availability = setup('en', { availabilityFailure: true })
    expect(await availability.view.findByText('Action failed: availability unavailable')).toBeDefined()
  })

  it('renders loading, unavailable, and non-writable states', async () => {
    const loading = setup('en', { status: 'loading' })
    expect(await loading.view.findByText('Loading fleet settings…')).toBeDefined()
    cleanup()

    const unavailable = setup('en', { status: 'unavailable' })
    expect(await unavailable.view.findByText('This connection cannot read or write fleet settings.')).toBeDefined()
    cleanup()

    const readOnly = setup('en', { writable: false })
    expect(await readOnly.view.findByText('This connection cannot read or write fleet settings.')).toBeDefined()
    fireEvent.click(readOnly.view.getByRole('button', { name: 'Refresh availability' }))
  })

  it('defaults a new member to spawn when no provider is ready', async () => {
    const { view } = setup('en', {
      providers: [{ name: 'missing', state: 'not-installed', continuable: false }],
    })
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    expect((view.getByLabelText('Provider') as HTMLSelectElement).value).toBe('spawn')
    fireEvent.click(view.getByRole('button', { name: 'Add member' }))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
  })

  it('refreshes availability from the header and renders an empty favorites list', async () => {
    const { view } = setup('en', { favorites: [], emptySnapshot: true })
    expect(await view.findByText('No saved fleets yet.')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: 'Refresh availability' }))
    expect(await view.findByText('Provider availability')).toBeDefined()
  })

  it('disables launch without a session and deletes a favorite', async () => {
    const { view, save } = setup('en', { canLaunch: false })
    const launch = await view.findByRole('button', { name: 'Launch' })
    expect(launch.hasAttribute('disabled')).toBe(true)
    expect(launch.getAttribute('title')).toBe('Open a session before launching a fleet.')
    fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    expect(save).toHaveBeenCalledWith([])
  })

  it('renders Arabic copy inside an RTL container', async () => {
    const { view } = setup('ar')
    const root = view.container.firstElementChild as HTMLElement
    root.setAttribute('dir', 'rtl')

    expect(await view.findByText('إعدادات Fleet')).toBeDefined()
    expect(await view.findByText('توفر provider')).toBeDefined()
    expect(await view.findByText('Fleets المحفوظة')).toBeDefined()
    expect(root.getAttribute('dir')).toBe('rtl')
  })
})

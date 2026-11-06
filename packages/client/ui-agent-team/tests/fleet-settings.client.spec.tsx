// @vitest-environment jsdom
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import type { FleetFavorite, FleetProviderAvailability } from '@greeneek/gnk-agent-team/client'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
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
  { name: 'spawn', state: 'ready', oneShot: true, continuable: true },
  { name: 'claude-code', state: 'one-shot', oneShot: true, continuable: false },
  { name: 'absent-cli', state: 'not-installed', oneShot: false, continuable: false },
]

/** Starter templates the host catalog returns, in shipped shape. */
const STARTERS: FleetFavorite[] = [
  {
    id: 'development',
    name: 'Development',
    members: [
      { name: 'implementer', description: 'write the change', prompt: 'Implement it.', provider: 'spawn' },
      { name: 'verifier', description: 'run the checks', prompt: 'Run the checks.', provider: 'spawn', readOnly: true },
    ],
  },
]

/** One accepted fleet mutation, shaped like the remote result the page consumes. */
function mutationAccepted(): unknown {
  return { ok: true as const, value: { ok: true as const, value: { providers: [], favorites: [], revision: 2 } } }
}

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
  readonly starters?: readonly FleetFavorite[]
  readonly startersFailure?: 'error' | 'throw'
  readonly fleetAction?: () => Promise<unknown>
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
    async loadStarters() {
      if (options.startersFailure === 'throw') throw new RemoteError('gateway/internal', 'starters unreachable', {})
      if (options.startersFailure === 'error') {
        return { ok: false as const, error: new RemoteError('gateway/internal', 'starters unreachable', {}) }
      }
      return { ok: true as const, value: options.starters ?? STARTERS }
    },
    duplicate: vi.fn((options.fleetAction ?? (async () => mutationAccepted())) as never),
    installStarter: vi.fn((options.fleetAction ?? (async () => mutationAccepted())) as never),
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
  it('names each provider by what it is and the run types it really supports', async () => {
    const { view } = setup()

    expect(await view.findByText('Provider availability')).toBeDefined()
    // Harmony and Melody name how a member runs; the distinction is the provider's
    // own capability: the in-process pair holds a lane, a registered external
    // adapter runs one delegation to a result.
    expect(await view.findByText('Harmony and Melody')).toBeDefined()
    expect(await view.findByText('Melody only')).toBeDefined()
    expect(await view.findByText('Not installed')).toBeDefined()
    expect(await view.findByText(/they are not the agent modes beside the composer/u)).toBeDefined()
    expect(view.queryByText(/execution modes/u)).toBeNull()
    expect(await view.findByText('Review fleet')).toBeDefined()
    expect(await view.findByText('1 member(s)')).toBeDefined()

    // A provider Greeneek ships is named by its product name, and the registry
    // name it persists stays visible; one the deployment configured is shown by
    // that name, because the client cannot know what its owner called it.
    const availability = view.getByRole('list', { name: 'Provider availability' })
    expect(within(availability).getByText('Greeneek built-in (fresh context)')).toBeTruthy()
    expect(within(availability).getByText('Claude Code')).toBeTruthy()
    expect(within(availability).getByText('spawn')).toBeTruthy()
    expect(within(availability).getByText('claude-code')).toBeTruthy()
    expect(within(availability).getByText('absent-cli')).toBeTruthy()

    // A run type is never offered as a provider, in the list or in the member selector.
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    const select = view.getByLabelText('Provider') as HTMLSelectElement
    expect(select.querySelector('option[value="Harmony and Melody"]')).toBeNull()
    expect(select.querySelector('option[value="Melody only"]')).toBeNull()
    expect(select.querySelector('option[value="spawn"]')?.textContent)
      .toBe('Greeneek built-in (fresh context) (spawn) — Harmony and Melody')
    expect(select.querySelector('option[value="claude-code"]')?.textContent)
      .toBe('Claude Code (claude-code) — Melody only')
  })

  it('offers a one-shot provider as a member and keeps an uninstalled one disabled', async () => {
    const { view } = setup()
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))

    const select = view.getByLabelText('Provider') as HTMLSelectElement
    const option = (name: string): HTMLOptionElement | null => select.querySelector(`option[value="${name}"]`)
    // A registered provider without a durable lane can still be a fleet member: it runs
    // one delegation to a result. Only a provider this composition does not register
    // stays unselectable, because the launcher would refuse it.
    expect(option('claude-code')?.disabled).toBe(false)
    expect(option('claude-code')?.textContent).toContain('Melody only')
    expect(option('absent-cli')?.disabled).toBe(true)
    fireEvent.change(select, { target: { value: 'claude-code' } })
    expect(select.value).toBe('claude-code')
  })

  it('defaults a new member to the first selectable provider when no provider holds a lane', async () => {
    const { view } = setup('en', { providers: PROVIDERS.filter(provider => provider.state !== 'ready') })
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    expect((view.getByLabelText('Provider') as HTMLSelectElement).value).toBe('claude-code')
  })

  it('falls back to the composition default provider before availability has loaded', async () => {
    const { view } = setup('en', { providers: [] })
    expect(await view.findByText('This composition registers no provider.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    expect((view.getByLabelText('Provider') as HTMLSelectElement).value).toBe('spawn')
  })

  it('echoes each member before launch and starts nothing on cancel', async () => {
    const { view, launch } = setup()
    fireEvent.click(await view.findByRole('button', { name: 'Launch' }))

    const dialog = await view.findByRole('alertdialog', { name: 'Confirm fleet launch' })
    expect(dialog.textContent).toContain('reviewer: Greeneek built-in (fresh context) (spawn)')
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
    fireEvent.change(view.getByLabelText('Timeout (ms)'), { target: { value: '30000' } })
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
        timeoutMs: 30_000,
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
    fireEvent.change(view.getByLabelText('Timeout (ms)'), { target: { value: '0' } })
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
    expect(saved.members[0]?.timeoutMs).toBeUndefined()

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
    expect(dialog.textContent).toContain('shared: Greeneek built-in (fresh context) (spawn)')
    expect(dialog.textContent).toContain('inherited, inherited, inherited, unbounded, shared checkout')
    expect(dialog.textContent).toContain('scoped: Greeneek built-in (fresh context) (spawn)')
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
      providers: [{ name: 'missing', state: 'not-installed', oneShot: false, continuable: false }],
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
    expect(await view.findByText('توفّر المزوّد')).toBeDefined()
    expect(await view.findByText('Fleets المحفوظة')).toBeDefined()
    expect(root.getAttribute('dir')).toBe('rtl')
  })

  it('renames a saved fleet in place instead of appending a second row', async () => {
    const { view, save } = setup()
    await view.findByText('Review fleet')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    fireEvent.change(view.getByLabelText(/Fleet id/), { target: { value: 'review-renamed' } })
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))

    // The row the editor opened from is replaced, so one fleet is stored: the new id
    // with the original member, and the old id is gone.
    const stored = save.mock.calls[0]![0]
    expect(stored.map(favorite => favorite.id)).toEqual(['review-renamed'])
    expect(stored[0]!.members.map(member => member.name)).toEqual(FAVORITE.members.map(member => member.name))
  })

  it('adds a member on the same default provider the first member got', async () => {
    const { view } = setup('en', { providers: PROVIDERS.filter(provider => provider.state !== 'ready') })
    await view.findByText('Provider availability')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    fireEvent.click(view.getByRole('button', { name: 'Add member' }))

    // A fleet over providers that hold no durable lane must not silently pin a lane
    // provider, so both members start on the selectable one.
    const selects = view.getAllByLabelText('Provider') as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    expect(selects[0]!.value).toBe('claude-code')
    expect(selects[1]!.value).toBe('claude-code')
  })

  it('previews each starter fleet and installs it as an editable favorite', async () => {
    const { view } = setup()
    await view.findByText('Provider availability')
    expect(view.getByText('Starter fleets')).toBeTruthy()
    expect(view.getByText('Development')).toBeTruthy()
    // The preview is the host's own template: exactly what Install would create.
    expect(view.getByText('implementer — write the change (Greeneek built-in (fresh context) (spawn))')).toBeTruthy()
    expect(view.getByText('verifier — run the checks (Greeneek built-in (fresh context) (spawn))')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Install' }))
    expect(await view.findByText('Starter installed as an editable fleet.')).toBeTruthy()
  })

  it('reports a fleet mutation the host refuses', async () => {
    const { view } = setup('en', {
      fleetAction: async () => ({
        ok: true,
        value: { ok: false, error: { code: 'fleet-conflict', message: 'fleet settings changed elsewhere' } },
      }),
    })
    fireEvent.click(view.getByRole('button', { name: 'Duplicate' }))
    expect(await view.findByText(/fleet settings changed elsewhere/)).toBeTruthy()
  })

  it('reports a fleet mutation that failed before reaching the host', async () => {
    const { view } = setup('en', {
      fleetAction: async () => ({ ok: false, error: new RemoteError('gateway/internal', 'fleet gateway down', {}) }),
    })
    // The starter catalog must have rendered before the Install control exists.
    await view.findByText('Development')
    fireEvent.click(view.getByRole('button', { name: 'Install' }))
    expect(await view.findByText(/fleet gateway down/)).toBeTruthy()
  })

  it('reports a fleet mutation that never reached the host', async () => {
    const { view } = setup('en', { fleetAction: async () => { throw new Error('socket closed mid-call') } })
    fireEvent.click(view.getByRole('button', { name: 'Duplicate' }))
    expect(await view.findByText(/socket closed mid-call/)).toBeTruthy()
  })

  it('reports a starter catalog the composition cannot read and still lists favorites', async () => {
    const { view } = setup('en', { startersFailure: 'error' })
    expect(await view.findByText(/starters unreachable/)).toBeTruthy()
    expect(view.queryByText('Starter fleets')).toBeNull()
    expect(view.getByText('Review fleet')).toBeTruthy()
  })

  it('reports a starter catalog whose read rejects outright', async () => {
    const { view } = setup('en', { startersFailure: 'throw' })
    expect(await view.findByText(/starters unreachable/)).toBeTruthy()
  })

  it('blocks a disabled fleet, names why, and re-enables it from the editor', async () => {
    const { view, save } = setup('en', { favorites: [{ ...FAVORITE, enabled: false }] })
    const launch = await view.findByRole('button', { name: 'Launch' })
    expect(launch.hasAttribute('disabled')).toBe(true)
    expect(launch.getAttribute('title')).toBe('Enable this fleet to launch it.')
    expect(view.getByText('Disabled')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    const enabled = view.getByLabelText('Enabled') as HTMLInputElement
    expect(enabled.checked).toBe(false)
    fireEvent.click(enabled)
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))
    // Re-enabling stores no key at all, so the row keeps the shape a fleet had
    // before the field existed instead of writing an explicit default.
    expect(save.mock.calls[0]![0]).toEqual([FAVORITE])
  })

  it('stores a disabled flag when the owner turns a fleet off', async () => {
    const { view, save } = setup()
    await view.findByText('Review fleet')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    const enabled = view.getByLabelText('Enabled') as HTMLInputElement
    expect(enabled.checked).toBe(true)
    fireEvent.click(enabled)
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))
    expect(save.mock.calls[0]![0]).toEqual([{ ...FAVORITE, enabled: false }])
  })

  it('stores concurrency above the sequential default', async () => {
    const { view, save } = setup()
    await view.findByText('Review fleet')
    expect(view.queryByText(/at once/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    // 1 is what the launcher already does, so an unset fleet reads as 1.
    expect((view.getByLabelText('Members at once') as HTMLInputElement).value).toBe('1')
    // With one member and one requested start, the field explains the batching
    // rule rather than warning about a batch the fleet cannot exceed.
    expect(view.getByText('How many members one launch starts simultaneously; 1 starts them one after another.')).toBeTruthy()
    fireEvent.change(view.getByLabelText('Members at once'), { target: { value: '3' } })
    // A batch larger than the fleet has no hidden meaning: the page states that
    // every member starts together instead of leaving the number unexplained.
    expect(view.getByText('Asking for more than 1 starts every member together, because the fleet has no more members.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))
    expect(save.mock.calls[0]![0][0]!.concurrency).toBe(3)
    // The saved row states the setting, so the list itself shows what a launch does.
    expect(await view.findByText('3 at once')).toBeTruthy()
  })

  it('stores no concurrency key once the owner returns to sequential launches', async () => {
    const { view, save } = setup('en', { favorites: [{ ...FAVORITE, concurrency: 3 }] })
    await view.findByText('3 at once')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    fireEvent.change(view.getByLabelText('Members at once'), { target: { value: '1' } })
    // An emptied field also reads as sequential, so a half-typed value cannot leave
    // a larger batch stored than the control displays.
    fireEvent.change(view.getByLabelText('Members at once'), { target: { value: '' } })
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))
    // Returning to 1 stores no key, so the row matches a fleet saved before the
    // field existed instead of carrying a redundant value.
    expect(Object.hasOwn(save.mock.calls[0]![0][0]!, 'concurrency')).toBe(false)
  })
})

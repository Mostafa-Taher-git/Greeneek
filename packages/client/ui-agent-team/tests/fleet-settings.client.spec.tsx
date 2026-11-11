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
    provider: 'greeneek',
    execution: 'harmony',
    context: 'fresh',
    model: 'mock',
    reasoningEffort: 'high',
    maxTokens: 4_000,
    readOnly: true,
  }],
}

const PROVIDERS: FleetProviderAvailability[] = [
  { name: 'greeneek', state: 'ready', oneShot: true, continuable: true },
  { name: 'claude-code', state: 'one-shot', oneShot: true, continuable: false },
  { name: 'absent-cli', state: 'not-installed', oneShot: false, continuable: false },
]

/** Live Harness descriptors the host returns: one Greeneek connection, never its strategies. */
const HARNESSSES = [
  { harness: 'greeneek', displayName: 'Greeneek', connection: 'greeneek', name: 'greeneek', state: 'ready', models: 'unknown', supportsAgentOptions: true, supportsContextFork: true, contextStrategies: ['fresh', 'fork'], source: 'registration', canProbe: false },
  { harness: 'claude-code', displayName: 'Claude Code', connection: 'claude-code', name: 'claude-code', state: 'one-shot', models: 'unknown', supportsAgentOptions: false, supportsContextFork: false, contextStrategies: ['fresh'], source: 'registration', canProbe: false },
  { harness: 'absent-cli', displayName: 'absent-cli', connection: 'absent-cli', name: 'absent-cli', state: 'not-installed', models: 'unknown', supportsAgentOptions: false, supportsContextFork: false, contextStrategies: [], source: 'registration', canProbe: false },
] as const

/** Starter templates the host catalog returns, in shipped shape. */
const STARTERS: FleetFavorite[] = [
  {
    id: 'development',
    name: 'Development',
    members: [
      { name: 'implementer', description: 'write the change', prompt: 'Implement it.', provider: 'greeneek', execution: 'harmony', context: 'fresh' },
      { name: 'verifier', description: 'run the checks', prompt: 'Run the checks.', provider: 'greeneek', execution: 'harmony', context: 'fresh', readOnly: true },
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
  readonly harnesses?: readonly unknown[]
  readonly favorites?: readonly FleetFavorite[]
  readonly emptySnapshot?: boolean
  readonly saveFailure?: unknown
  readonly launch?: () => Promise<unknown>
  readonly starters?: readonly FleetFavorite[]
  readonly startersFailure?: 'error' | 'throw'
  readonly fleetAction?: () => Promise<unknown>
  readonly harnessesThrow?: boolean
  readonly probeFailure?: 'error' | 'throw'
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
    loadHarnesses: async () => {
      if (options.harnessesThrow === true) throw new Error('inventory socket closed')
      if (options.availabilityFailure === true) {
        return { ok: false as const, error: new RemoteError('gateway/internal', 'availability unavailable', {}) }
      }
      if (options.providers !== undefined && options.harnesses === undefined) {
        return {
          ok: true as const,
          value: options.providers.map(row => ({
            harness: row.name,
            displayName: row.name,
            connection: row.name,
            name: row.name,
            state: row.state,
            models: 'unknown' as const,
            supportsAgentOptions: row.continuable,
            supportsContextFork: row.continuable,
            contextStrategies: row.continuable ? ['fresh', 'fork'] as const : ['fresh'] as const,
            source: 'registration' as const,
            canProbe: false,
          })),
        }
      }
      return { ok: true as const, value: options.harnesses ?? HARNESSSES }
    },
    refreshHarnesses: async () => ({ ok: true as const, value: options.harnesses ?? HARNESSSES }),
    refreshHarness: vi.fn(async (_connection: string) => {
      if (options.probeFailure === 'throw') throw new Error('probe socket closed')
      if (options.probeFailure === 'error') {
        return { ok: false as const, error: new RemoteError('gateway/internal', 'probe refused', {}) }
      }
      return { ok: true as const, value: options.harnesses ?? HARNESSSES }
    }) as never,
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
    { name: 'shared', description: 'shared', prompt: 'share', provider: 'greeneek' },
    { name: 'scoped', description: 'scoped', prompt: 'scope', provider: 'greeneek', writeScopes: ['src', 'docs'] },
  ],
}

describe('fleet settings section', () => {
  it('names each provider by what it is and the run types it really supports', async () => {
    const { view } = setup()

    expect(await view.findByText('Harness connections')).toBeDefined()
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

    // The Harness Greeneek ships is one connection named by its product name;
    // its internal execution strategies never reach the page. One the
    // deployment configured is shown by that name, because the client cannot
    // know what its owner called it.
    const greeneekGroup = view.getByRole('list', { name: 'Greeneek' })
    expect(within(greeneekGroup).getByText('Greeneek')).toBeTruthy()
    expect(within(greeneekGroup).getByText('greeneek')).toBeTruthy()
    const claudeGroup = view.getByRole('list', { name: 'Claude Code' })
    expect(within(claudeGroup).getByText('Claude Code')).toBeTruthy()
    expect(within(claudeGroup).getByText('claude-code')).toBeTruthy()
    expect(within(view.getByRole('list', { name: 'absent-cli' })).getByText('absent-cli')).toBeTruthy()

    // A run type is never offered as a connection, in the list or in the member selector.
    await view.findByText('Harness connections')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    const select = view.getByLabelText('Connection') as HTMLSelectElement
    expect(select.querySelector('option[value="Harmony and Melody"]')).toBeNull()
    expect(select.querySelector('option[value="Melody only"]')).toBeNull()
    expect(select.querySelector('option[value="fork"]')).toBeNull()
    expect(select.querySelector('option[value="spawn"]')).toBeNull()
    expect(select.querySelector('option[value="greeneek"]')?.textContent)
      .toBe('Greeneek — Harmony and Melody')
    fireEvent.change(view.getByLabelText('Harness'), { target: { value: 'claude-code' } })
    const claudeSelect = view.getByLabelText('Connection') as HTMLSelectElement
    expect(claudeSelect.querySelector('option[value="claude-code"]')?.textContent)
      .toBe('Claude Code — Melody only')
    // No internal strategy name is visible anywhere on the page.
    expect(view.container.textContent).not.toMatch(/\bfork\b|\bspawn\b/iu)
  })

  it('offers a one-shot provider as a member and keeps an uninstalled one disabled', async () => {
    const { view } = setup()
    await view.findByText('Harness connections')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))

    // Switch to the one-shot Harness, then its connection is selectable.
    fireEvent.change(view.getByLabelText('Harness'), { target: { value: 'claude-code' } })
    const select = view.getByLabelText('Connection') as HTMLSelectElement
    const option = (name: string): HTMLOptionElement | null => select.querySelector(`option[value="${name}"]`)
    // A registered provider without a durable lane can still be a fleet member: it runs
    // one delegation to a result. Only a provider this composition does not register
    // stays unselectable, because the launcher would refuse it.
    expect(option('claude-code')?.disabled).toBe(false)
    expect(option('claude-code')?.textContent).toContain('Melody only')
    fireEvent.change(select, { target: { value: 'claude-code' } })
    expect(select.value).toBe('claude-code')
  })

  it('states each member execution type and offers only the context strategies the connection runs', async () => {
    const { view } = setup()
    await view.findByText('Harness connections')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    expect(view.getByText(/Execution: Harmony — durable teammate lane/u)).toBeTruthy()
    const context = view.getByLabelText('Context') as HTMLSelectElement
    expect((context.querySelector('option[value="fresh"]') as HTMLOptionElement).disabled).toBe(false)
    expect((context.querySelector('option[value="fork"]') as HTMLOptionElement).disabled).toBe(false)
    fireEvent.change(view.getByLabelText('Harness'), { target: { value: 'claude-code' } })
    expect(view.getByText(/Execution: Melody — one delegation/u)).toBeTruthy()
    const claudeContext = view.getByLabelText('Context') as HTMLSelectElement
    expect((claudeContext.querySelector('option[value="fork"]') as HTMLOptionElement).disabled).toBe(true)
  })

  it('edits a legacy saved fleet as the Greeneek connection and writes the migrated member back', async () => {
    const legacy = decodeFleetSettings({
      favorites: [{
        id: 'legacy',
        name: 'Legacy fleet',
        members: [{ name: 'worker', description: 'work', prompt: 'go', provider: 'fork', model: 'mock' }],
      }],
    })
    if (legacy === undefined) throw new Error('expected a fleet section')
    const { view, save } = setup('en', { favorites: legacy.favorites })
    await view.findByText('Legacy fleet')
    // The summary names the Harness and its execution, never the strategy.
    expect(view.getByText('Greeneek (Harmony)')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    expect((view.getByLabelText('Connection') as HTMLSelectElement).value).toBe('greeneek')
    expect((view.getByLabelText('Context') as HTMLSelectElement).value).toBe('fork')
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    const saved = save.mock.calls[0]![0] as FleetFavorite[]
    expect(saved[0]!.members[0]).toMatchObject({ provider: 'greeneek', context: 'fork', execution: 'harmony', model: 'mock' })
  })

  it('defaults a new member to the first selectable provider when no provider holds a lane', async () => {
    const { view } = setup('en', { providers: PROVIDERS.filter(provider => provider.state !== 'ready') })
    await view.findByText('Harness connections')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    expect((view.getByLabelText('Connection') as HTMLSelectElement).value).toBe('claude-code')
  })

  it('falls back to the Greeneek connection before availability has loaded', async () => {
    const { view } = setup('en', { providers: [] })
    expect(await view.findByText('This composition has no registered or configured Harness connection yet.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    expect((view.getByLabelText('Connection') as HTMLSelectElement).value).toBe('greeneek')
  })

  it('echoes each member before launch and starts nothing on cancel', async () => {
    const { view, launch } = setup()
    fireEvent.click(await view.findByRole('button', { name: 'Launch' }))

    const dialog = await view.findByRole('alertdialog', { name: 'Confirm fleet launch' })
    expect(dialog.textContent).toContain('reviewer: Greeneek, Harmony,')
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
    await view.findByText('Harness connections')
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
    fireEvent.change(view.getByLabelText('Connection'), { target: { value: 'greeneek' } })
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
        provider: 'greeneek',
        execution: 'harmony',
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
    await view.findByText('Harness connections')
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
    expect(dialog.textContent).toContain('shared: Greeneek, Harmony,')
    expect(dialog.textContent).toContain('inherited, inherited, inherited, unbounded, shared checkout')
    expect(dialog.textContent).toContain('scoped: Greeneek, Harmony,')
    expect(dialog.textContent).toContain('scopes src, docs')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
  })

  it('clears and restores the optional preset field', async () => {
    const { view, save } = setup()
    await view.findByText('Harness connections')
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

  it('decodes only a fleet-shaped settings section and migrates legacy strategy members', () => {
    expect(decodeFleetSettings({ favorites: [] })).toEqual({ favorites: [] })
    expect(decodeFleetSettings(null)).toBeUndefined()
    expect(decodeFleetSettings({})).toBeUndefined()
    expect(decodeFleetSettings({ favorites: 'wrong' })).toBeUndefined()
    // Stored bytes naming an internal strategy read as the Harness connection,
    // so the editor never shows or writes the strategy name back.
    expect(decodeFleetSettings({
      favorites: [{
        id: 'legacy',
        name: 'Legacy',
        members: [{ name: 'worker', description: 'work', prompt: 'go', provider: 'spawn' }],
      }],
    })).toEqual({
      favorites: [{
        id: 'legacy',
        name: 'Legacy',
        members: [{ name: 'worker', description: 'work', prompt: 'go', provider: 'greeneek', context: 'fresh', execution: 'harmony' }],
      }],
    })
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
    fireEvent.click(readOnly.view.getByRole('button', { name: 'Probe Harness connections' }))
  })

  it('defaults a new member to the Greeneek connection when no provider is ready', async () => {
    const { view } = setup('en', {
      providers: [{ name: 'missing', state: 'not-installed', oneShot: false, continuable: false }],
    })
    await view.findByText('Harness connections')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    expect((view.getByLabelText('Connection') as HTMLSelectElement).value).toBe('greeneek')
    fireEvent.click(view.getByRole('button', { name: 'Add member' }))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
  })

  it('refreshes availability from the header and renders an empty favorites list', async () => {
    const { view } = setup('en', { favorites: [], emptySnapshot: true })
    expect(await view.findByText('No saved fleets yet.')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: 'Probe Harness connections' }))
    expect(await view.findByText('Harness connections')).toBeDefined()
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
    expect(await view.findByText('اتصالات Harness')).toBeDefined()
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
    await view.findByText('Harness connections')
    fireEvent.click(view.getByRole('button', { name: 'New fleet' }))
    fireEvent.click(view.getByRole('button', { name: 'Add member' }))

    // A fleet over providers that hold no durable lane must not silently pin a lane
    // provider, so both members start on the selectable one.
    const selects = view.getAllByLabelText('Connection') as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    expect(selects[0]!.value).toBe('claude-code')
    expect(selects[1]!.value).toBe('claude-code')
  })

  it('previews each starter fleet and installs it as an editable favorite', async () => {
    const { view } = setup()
    await view.findByText('Harness connections')
    expect(view.getByText('Starter fleets')).toBeTruthy()
    expect(view.getByText('Development')).toBeTruthy()
    // The preview is the host's own template: exactly what Install would create.
    expect(view.getByText('implementer — write the change (Greeneek, Harmony)')).toBeTruthy()
    expect(view.getByText('verifier — run the checks (Greeneek, Harmony)')).toBeTruthy()

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

  /** Two connections of one Harness plus a fully advertising ready connection. */
  const RICH_HARNESSES = [
    { harness: 'opencode', displayName: 'OpenCode', connection: 'opencode-work', name: 'opencode-work', state: 'unauthenticated', models: 'unknown', supportsAgentOptions: false, supportsContextFork: false, contextStrategies: ['fresh'], source: 'configuration', canProbe: false, discoveryError: '401 Unauthorized', discoveredAt: '2026-11-08T10:00:00.000Z', prompt: { image: false, audio: false, embeddedContext: false } },
    { harness: 'opencode', displayName: 'OpenCode', connection: 'opencode-home', name: 'opencode-home', state: 'temporarily-unavailable', models: 'unknown', supportsAgentOptions: false, supportsContextFork: false, contextStrategies: ['fresh'], source: 'acp-initialize', canProbe: true, discoveryError: 'probe timed out', sessions: { new: true } },
    { harness: 'kilo', displayName: 'KiloCode', connection: 'kilo', name: 'kilo', state: 'ready', models: [{ id: 'kilo/big', name: 'Kilo Big', efforts: [{ id: 'high', name: 'High' }, { id: 'low' }] }, { id: 'kilo/small' }, { id: 'kilo/empty', efforts: [] }, { id: 'kilo/same', name: 'kilo/same' }], supportsAgentOptions: true, supportsContextFork: false, contextStrategies: ['fresh'], source: 'acp-session', canProbe: true, sessions: { new: true, load: true, resume: true, fork: true, list: true, delete: true }, prompt: { image: true, audio: true, embeddedContext: true }, permissions: [{ id: 'default', name: 'Default' }], authMethods: [{ id: 'api-key', name: 'API key' }, { id: 'oauth' }] },
  ]

  it('groups two connections under one Harness and states how each fact was learned', async () => {
    const { view } = setup('en', { harnesses: RICH_HARNESSES, favorites: [] })
    expect(await view.findByText('from configuration')).toBeDefined()
    expect(view.getByText('from ACP initialize')).toBeDefined()
    expect(view.getByText('from an ACP session')).toBeDefined()
    expect(view.getByText('Unauthenticated')).toBeDefined()
    expect(view.getByText('Temporarily unavailable')).toBeDefined()
    expect(view.getByText('Probe failed: 401 Unauthorized')).toBeDefined()
    expect(view.getByText('Probe failed: probe timed out')).toBeDefined()
    expect(view.getByText(/Probed /u)).toBeDefined()
    // One group per Harness, with the unbranded connection named beside its product.
    const group = view.getByRole('list', { name: 'OpenCode' })
    expect(within(group).getByText('OpenCode (opencode-work)')).toBeTruthy()
    expect(within(group).getByText('OpenCode (opencode-home)')).toBeTruthy()
    // Advertised facts render as one compact capability line.
    expect(view.getByText(/4 model\(s\)/u)).toBeTruthy()
    expect(view.getByText(/sessions: load, resume, branch session, list, delete/u)).toBeTruthy()
    expect(view.getByText(/input: image, audio, embeddedContext/u)).toBeTruthy()
    expect(view.getByText(/permissions: default/u)).toBeTruthy()
    expect(view.getByText(/auth: API key, oauth/u)).toBeTruthy()
    expect(view.getAllByText('model catalog unknown').length).toBeGreaterThan(0)
  })

  it('probes one connection from its row and reports a refused or broken probe', async () => {
    const ok = setup('en', { harnesses: RICH_HARNESSES, favorites: [] })
    await ok.view.findByText('Harness connections')
    fireEvent.click(ok.view.getAllByRole('button', { name: 'Probe' })[0]!)
    await vi.waitFor(() => { expect(ok.view.getByText('Probe failed: probe timed out')).toBeTruthy() })
    cleanup()

    const refused = setup('en', { harnesses: RICH_HARNESSES, favorites: [], probeFailure: 'error' })
    await refused.view.findByText('Harness connections')
    fireEvent.click(refused.view.getAllByRole('button', { name: 'Probe' })[0]!)
    expect(await refused.view.findByText('Action failed: probe refused')).toBeDefined()
    cleanup()

    const broken = setup('en', { harnesses: RICH_HARNESSES, favorites: [], probeFailure: 'throw' })
    await broken.view.findByText('Harness connections')
    fireEvent.click(broken.view.getAllByRole('button', { name: 'Probe' })[0]!)
    expect(await broken.view.findByText('Action failed: probe socket closed')).toBeDefined()
    cleanup()

    // The read-only settings state still offers the per-connection probe.
    const readOnly = setup('en', { harnesses: RICH_HARNESSES, writable: false })
    await readOnly.view.findByText('This connection cannot read or write fleet settings.')
    fireEvent.click(readOnly.view.getAllByRole('button', { name: 'Probe' })[0]!)
    cleanup()

    const loadBroken = setup('en', { harnessesThrow: true })
    expect(await loadBroken.view.findByText('Action failed: inventory socket closed')).toBeDefined()
  })

  it('renders advertised models and per-model effort levels, refusing nothing silently', async () => {
    const favorite: FleetFavorite = {
      id: 'kilo-fleet',
      name: 'Kilo fleet',
      members: [
        { name: 'big', description: 'big model', prompt: 'go', provider: 'kilo', model: 'kilo/big', reasoningEffort: 'high' },
        { name: 'ghost', description: 'unadvertised effort', prompt: 'go', provider: 'kilo', model: 'kilo/big', reasoningEffort: 'ultra' },
        { name: 'stray', description: 'unadvertised model', prompt: 'go', provider: 'kilo', model: 'ghost-model' },
      ],
    }
    const { view } = setup('en', { harnesses: RICH_HARNESSES, favorites: [favorite] })
    await view.findByText('Kilo fleet')
    fireEvent.click(view.getAllByRole('button', { name: 'Edit' })[0]!)
    const model = view.getAllByLabelText('Model')[0] as HTMLSelectElement
    expect(model.value).toBe('kilo/big')
    expect(model.querySelector('option[value="kilo/big"]')?.textContent).toBe('Kilo Big (kilo/big)')
    expect(model.querySelector('option[value=""]')?.textContent).toBe('Harness default')
    const effort = view.getAllByLabelText('Reasoning effort')[0] as HTMLSelectElement
    expect(effort.querySelector('option[value="high"]')?.textContent).toBe('High (high)')
    expect(effort.querySelector('option[value="low"]')?.textContent).toBe('low')
    // An effort the selected model does not advertise stays visible and named.
    const ghostEffort = view.getAllByLabelText('Reasoning effort')[1] as HTMLSelectElement
    expect(ghostEffort.querySelector('option[value="ultra"]')?.textContent).toBe('ultra — not advertised')
    // A model the catalog does not advertise keeps the manual effort field.
    const strayModel = view.getAllByLabelText('Model')[2] as HTMLSelectElement
    expect(strayModel.querySelector('option[value="ghost-model"]')?.textContent).toBe('ghost-model — not advertised')
    expect((view.getAllByLabelText('Reasoning effort')[2] as HTMLInputElement).tagName).toBe('INPUT')
    // Switching to a model without effort levels falls back to the manual field
    // and says the value is checked at launch.
    fireEvent.change(model, { target: { value: 'kilo/small' } })
    expect((view.getAllByLabelText('Reasoning effort')[0] as HTMLInputElement).tagName).toBe('INPUT')
    expect(view.getAllByText(/This connection advertises models but no reasoning levels/u).length).toBeGreaterThan(0)
    // An empty effort catalog is the same unknown, not an empty selector.
    fireEvent.change(model, { target: { value: 'kilo/empty' } })
    expect((view.getAllByLabelText('Reasoning effort')[0] as HTMLInputElement).tagName).toBe('INPUT')
    fireEvent.change(view.getAllByLabelText('Reasoning effort')[0]!, { target: { value: 'high' } })
    fireEvent.change(model, { target: { value: 'kilo/big' } })
    fireEvent.change(view.getAllByLabelText('Reasoning effort')[0]!, { target: { value: 'low' } })
    fireEvent.change(view.getAllByLabelText('Reasoning effort')[0]!, { target: { value: '' } })
    fireEvent.change(model, { target: { value: '' } })
  })

  it('keeps an unmounted member editable and saves it without inventing an execution type', async () => {
    const favorite: FleetFavorite = {
      id: 'orphan',
      name: 'Orphan fleet',
      members: [{ name: 'gone', description: 'gone', prompt: 'go', provider: 'gone-acp' }],
    }
    const { view, save } = setup('en', { favorites: [favorite] })
    await view.findByText('Orphan fleet')
    expect(view.getByText('gone-acp')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    const harness = view.getByLabelText('Harness') as HTMLSelectElement
    expect(harness.querySelector('option[value="gone-acp"]')?.textContent).toBe('gone-acp — Not installed')
    const connection = view.getByLabelText('Connection') as HTMLSelectElement
    expect(connection.querySelector('option[value="gone-acp"]')?.textContent).toBe('gone-acp — Not installed')
    expect((view.getByLabelText('Model') as HTMLInputElement).tagName).toBe('INPUT')
    // A disabled Harness group cannot be selected into.
    fireEvent.change(harness, { target: { value: 'absent-cli' } })
    expect((view.getByLabelText('Connection') as HTMLSelectElement).value).toBe('gone-acp')
    fireEvent.click(view.getByRole('button', { name: /^Save/ }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    const saved = (save.mock.calls[0]![0] as FleetFavorite[]).find(candidate => candidate.id === 'orphan')
    expect(saved?.members[0]).toEqual(favorite.members[0])
    // The launch card names the unmounted member without an execution guess.
    await view.findByText('Fleet saved.')
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    const dialog = view.getByRole('alertdialog')
    expect(dialog.textContent).toContain('gone: gone-acp,')
    expect(dialog.textContent).not.toContain('Harmony')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
  })

  it('names a branded connection that is not mounted and echoes Melody members before launch', async () => {
    const favorite: FleetFavorite = {
      id: 'external',
      name: 'External fleet',
      members: [
        { name: 'coder', description: 'codes', prompt: 'go', provider: 'claude-code', execution: 'melody' },
        { name: 'empty-scopes', description: 'empty', prompt: 'go', provider: 'claude-code', writeScopes: [] },
      ],
    }
    const { view } = setup('en', {
      harnesses: [HARNESSSES[0]],
      favorites: [favorite],
    })
    await view.findByText('External fleet')
    expect(view.getAllByText(/Claude Code \(claude-code\)/u).length).toBeGreaterThan(0)
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    const dialog = view.getByRole('alertdialog')
    expect(dialog.textContent).toContain('coder: Claude Code (claude-code), Melody,')
    expect(dialog.textContent).toContain('shared checkout')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
  })

  it('keeps a supported context when the connection is reselected and previews starters without execution', async () => {
    const favorite: FleetFavorite = {
      id: 'inheriting',
      name: 'Inheriting fleet',
      members: [{ name: 'heir', description: 'inherits', prompt: 'go', provider: 'greeneek', context: 'fork' }],
    }
    const starters: FleetFavorite[] = [{
      id: 'plain',
      name: 'Plain starter',
      members: [
        { name: 'worker', description: 'works', prompt: 'go', provider: 'gone-acp' },
        { name: 'delegate', description: 'delegates', prompt: 'go', provider: 'claude-code' },
      ],
    }]
    const { view } = setup('en', { favorites: [favorite], starters })
    await view.findByText('Inheriting fleet')
    // A starter member on an unmounted connection previews without an execution
    // guess; a one-shot connection previews its Melody delegation.
    expect(view.getByText('worker — works (gone-acp)')).toBeTruthy()
    expect(view.getByText('delegate — delegates (Claude Code, Melody)')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    fireEvent.change(view.getByLabelText('Connection'), { target: { value: 'greeneek' } })
    expect((view.getByLabelText('Context') as HTMLSelectElement).value).toBe('fork')
  })
})

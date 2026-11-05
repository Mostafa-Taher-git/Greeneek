// @vitest-environment jsdom
/**
 * The two conversation-adjacent surfaces: the new-session chip naming the
 * next session's preset, and the session header's read-only label. The split
 * is the host's rule — a session's history is produced under its preset's
 * tools, so the choice is only ever offered before one starts.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@greeneek/gnk-client-test-runtime'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelProps } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetSeat } from '../src/client/AgentPresetSeat.tsx'
import type { AgentPresetSeatProps } from '../src/client/AgentPresetSeat.tsx'
import { ModeSwitcher } from '../src/client/ModeSwitcher.tsx'
import type { AgentPresetSettingsState } from '../src/client/settings-store.ts'
import type { AgentPresetSeatState } from '../src/client/seat-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const ROSTER_READY: AgentPresetSettingsState = {
  status: 'ready',
  error: null,
  options: [{ id: 'standard', trust: 'system', name: '标准模式' }, { id: 'mine', trust: 'user' }],
}

const SEAT_READY: AgentPresetSeatState = {
  current: 'standard',
  options: [
    { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    { id: 'army', trust: 'system', name: 'Army 模式' },
    { id: 'maestro', trust: 'system', name: '指挥模式', description: '持久多泳道编排。' },
    { id: 'mine', trust: 'user' },
  ],
  busy: false,
  error: null,
  introduce: false,
}

/** The runtime's own `{name}` substitution, so a test reads the shown text. */
function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function renderSeat(
  state: Partial<AgentPresetSeatState> = {},
  select: () => Promise<string | undefined> = () => Promise.resolve(undefined),
) {
  const store = createSnapshotStore<AgentPresetSeatState>({ ...SEAT_READY, ...state })
  const actions = { load: vi.fn(() => Promise.resolve()), select: vi.fn(select), introduced: vi.fn() }
  render(<AgentPresetSeat {...({
    ...actions,
    useAgentPresetSeat: bindSnapshotSelector(store),
    t: translate,
  } as unknown as AgentPresetSeatProps)} />)
  return actions
}

function renderLabel(
  summary: { blank: boolean; projectionValues?: { agentPreset?: string | null } } | undefined,
  roster: Partial<AgentPresetSettingsState> = {},
) {
  // The chip and the label read the same roster, metadata included.
  const store = createSnapshotStore<AgentPresetSettingsState>({
    ...ROSTER_READY, options: SEAT_READY.options, ...roster,
  })
  const sessions = createSnapshotStore({ byId: summary === undefined ? {} : { s1: summary } })
  const load = vi.fn(() => Promise.resolve())
  const view = render(<AgentPresetLabel {...({
    load,
    sessionId: 's1',
    useSessions: bindSnapshotSelector(sessions),
    useAgentPresets: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetLabelProps)} />)
  return { load, view }
}

describe('the new-session mode dropdown', () => {
  /** The glyph-and-name trigger; the menu exists only while it is open. */
  const trigger = (): HTMLButtonElement => screen.getByRole('button', { name: en.switcherLabel })

  /** Open the menu and return its rows in shown order. */
  const openMenu = (): HTMLButtonElement[] => {
    fireEvent.click(trigger())
    return screen.getAllByRole('menuitem')
  }

  /** A row's own leading glyph plus the trailing check Menu draws when it is staged. */
  const glyphCount = (row: Element): number => row.querySelectorAll('svg').length

  it('reads the roster once and names the staged mode on the trigger', async () => {
    const actions = renderSeat()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect(trigger().textContent).toBe(en.presetStandardName)
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    // Nothing outside the menu states what a mode does, so the hero row holds one
    // compact control whatever mode is staged, and the description is read in the
    // row that offers it.
    expect(screen.queryByText(en.presetStandardDescription)).toBeNull()
    expect(trigger().getAttribute('aria-describedby')).toBeNull()
  })

  it('orders shipped modes first, authored presets last, and names what each one does', () => {
    renderSeat({
      current: 'cordis',
      options: [
        { id: 'mine', trust: 'user' },
        { id: 'cordis', trust: 'system' },
        { id: 'standard', trust: 'system' },
        { id: 'army', trust: 'system' },
        { id: 'maestro', trust: 'system' },
      ],
    })

    const rows = openMenu()
    expect(rows.map(row => row.textContent)).toEqual([
      `${en.presetStandardName}${en.presetStandardDescription}`,
      `${en.presetArmyName}${en.presetArmyDescription}`,
      `${en.presetMaestroName}${en.presetMaestroDescription}`,
      `${en.presetCordisName}${en.presetCordisDescription}`,
      `mine${en.noDescription}`,
    ])
    expect(trigger().textContent).toBe(en.presetCordisName)
    // Army and Maestro start sessions, so neither row is parked.
    expect(rows.map(row => row.disabled)).toEqual([false, false, false, false, false])
    // Every mode carries its own glyph now that a row can hold one.
    expect(rows.map(glyphCount)).toEqual([1, 1, 1, 2, 1])
  })

  it('retires the PTC row while the roster keeps supplying the preset', () => {
    const options = [
      { id: 'mine', trust: 'user' as const },
      { id: 'cordis', trust: 'system' as const },
      { id: 'ptc', trust: 'system' as const, retired: true },
      { id: 'standard', trust: 'system' as const },
      { id: 'army', trust: 'system' as const },
      { id: 'maestro', trust: 'system' as const },
    ]
    renderSeat({ current: 'ptc', options })

    // PTC still composes sessions — Settings and custom presets start it, and
    // recorded PTC sessions keep replaying — but v0.3.4 retires its row, so the
    // menu offers the shipped modes and appends only `mine`.
    const rows = openMenu()
    expect(options.map(option => option.id)).toContain('ptc')
    expect(rows.map(row => row.textContent)).toEqual([
      `${en.presetStandardName}${en.presetStandardDescription}`,
      `${en.presetArmyName}${en.presetArmyDescription}`,
      `${en.presetMaestroName}${en.presetMaestroDescription}`,
      `${en.presetCordisName}${en.presetCordisDescription}`,
      `mine${en.noDescription}`,
    ])
    expect(rows.map(row => row.textContent).join('\n')).not.toContain(en.presetPtcName)
    // A session already on PTC keeps naming PTC on the trigger, so the control
    // never displays a mode the session is not running.
    expect(trigger().textContent).toBe('ptc')
  })

  it('falls back to the id when the staged preset published no name', () => {
    renderSeat({ current: 'mine' })

    expect(trigger().textContent).toBe('mine')
    expect(glyphCount(openMenu().find(row => row.textContent === `mine${en.noDescription}`)!)).toBe(2)
  })

  it('names a staged id the roster no longer offers on the trigger', () => {
    renderSeat({ current: 'arriving' })

    expect(trigger().textContent).toBe('arriving')
    // Nothing staged among these rows, so none of them carries the check.
    expect(openMenu().map(glyphCount)).toEqual([1, 1, 1, 1])
  })

  it('renders one row per mode with no cap on how many the roster offers', () => {
    const authored = Array.from({ length: 24 }, (_, index) => ({ id: `authored-${index}`, trust: 'user' as const }))
    renderSeat({ current: 'standard', options: [{ id: 'standard', trust: 'system' }, ...authored] })

    // Owners author modes through Creator, so the list is the roster: the shipped
    // mode plus every authored preset, each its own row.
    expect(openMenu()).toHaveLength(25)
  })

  it('stages the picked preset on select and closes the menu', () => {
    const actions = renderSeat()

    fireEvent.click(openMenu().find(row => row.textContent === `mine${en.noDescription}`)!)

    expect(actions.select).toHaveBeenCalledWith('mine')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape without staging a mode', () => {
    const actions = renderSeat()

    openMenu()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(actions.select).not.toHaveBeenCalled()
  })

  it('disables the trigger while a switch is in flight and opens nothing', () => {
    renderSeat({ busy: true })

    expect(trigger()).toHaveProperty('disabled', true)
    fireEvent.click(trigger())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('draws the staged mode\'s glyph on the trigger before the menu opens', () => {
    renderSeat()

    // One glyph while closed: the staged mode's own, on the trigger.
    expect(document.querySelectorAll('svg')).toHaveLength(1)
  })

  it('keeps naming the staged mode while a switch is in flight', () => {
    const actions = renderSeat()

    fireEvent.click(openMenu().find(row => row.textContent === `${en.presetMaestroName}${en.presetMaestroDescription}`)!)

    // The host has not committed the switch, so the trigger still names the mode
    // that is actually staged; a refusal leaves it there.
    expect(actions.select).toHaveBeenCalledWith('maestro')
    expect(trigger().textContent).toBe(en.presetStandardName)
  })

  it('renders nothing before the roster arrives or when there is none', () => {
    const empty = renderSeat({ options: [] })
    expect(empty).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.switcherLabel })).toBeNull()
    cleanup()

    renderSeat({ current: '' })
    expect(screen.queryByRole('button', { name: en.switcherLabel })).toBeNull()
  })

  it('acknowledges the introduce cue at once instead of animating it', () => {
    const actions = renderSeat({ introduce: true })

    expect(actions.introduced).toHaveBeenCalledTimes(1)
  })

  it('omits the description line for a mode that publishes none', () => {
    render(<ModeSwitcher
      label={en.switcherLabel}
      entries={[{ id: 'bare', name: 'Bare mode', icon: <span data-testid="bare-glyph" /> }]}
      current="bare"
      busy={false}
      onSelect={() => { }}
    />)

    // The staged mode has a glyph but no sentence, so its row is name-only.
    expect(openMenu().map(row => row.textContent)).toEqual(['Bare mode'])
  })
})

describe('a refused switch', () => {
  it('announces the reason instead of letting the row snap back in silence', async () => {
    // The banner's own timer has to be a fake one from the start, or the
    // lifetime assertion below would wait out its real nine seconds.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const reason = 'failed to import loader entry live-on-mac (@greeneek/gnk-also-gone)'
      renderSeat({}, () => Promise.resolve(reason))

      fireEvent.click(screen.getByRole('button', { name: en.switcherLabel }))
      fireEvent.click(screen.getAllByRole('menuitem').find(row => row.textContent === `mine${en.noDescription}`)!)

      // The host refuses a mount discovery reported healthy, so this banner is
      // the only place the cause appears — the trigger still names the mode that
      // stayed staged and the settings row shows the preset as fine.
      const banner = await screen.findByRole('alert')
      expect(banner.textContent).toContain(reason)
      expect(banner.textContent).toContain('mine')

      // Transient by design: it holds long enough to read a cause that names
      // packages, then leaves rather than sitting over the screen.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9001)
      })
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing when the switch lands', async () => {
    const actions = renderSeat()

    fireEvent.click(screen.getByRole('button', { name: en.switcherLabel }))
    fireEvent.click(screen.getAllByRole('menuitem').find(row => row.textContent === `mine${en.noDescription}`)!)

    await waitFor(() => { expect(actions.select).toHaveBeenCalledWith('mine') })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the session-header label', () => {
  it('names the preset the session runs, and never offers a switch', async () => {
    const { load } = renderLabel({
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    })

    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    // A control here would promise a switch the host refuses outright.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTitle(en.presetStandardDescription).textContent).toBe(en.presetStandardName)
  })

  it('falls back to the id, and to the generic hint, when metadata is absent', () => {
    renderLabel({ blank: true, projectionValues: { agentPreset: 'mine' } })

    expect(screen.getByTitle(en.headerHint).textContent).toBe('mine')
  })

  it('shows the id until the roster resolves it', () => {
    renderLabel({
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    }, { options: [] })

    // The session's own summary is the authority on which preset it runs; the
    // roster only supplies the display name, and its arrival is a later frame.
    expect(screen.getByTitle(en.headerHint).textContent).toBe('standard')
  })

  it('renders nothing, and reads no roster, when the session records no preset', async () => {
    const absent = renderLabel({ blank: true })
    expect(absent.view.container.firstChild).toBeNull()
    cleanup()

    // A session the list has not caught up to is the same answer: a deployment
    // that composes no presets must not pay for a roster read per header.
    const unknown = renderLabel(undefined)
    expect(unknown.view.container.firstChild).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(absent.load).not.toHaveBeenCalled()
    expect(unknown.load).not.toHaveBeenCalled()
  })
})

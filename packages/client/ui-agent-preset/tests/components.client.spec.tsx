// @vitest-environment jsdom
/**
 * The two conversation-adjacent surfaces: the new-session chip naming the
 * next session's preset, and the session header's read-only label. The split
 * is the host's rule — a session's history is produced under its preset's
 * tools, so the choice is only ever offered before one starts.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@greeneek/gnk-client-test-runtime'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelProps } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetSeat } from '../src/client/AgentPresetSeat.tsx'
import type { AgentPresetSeatProps } from '../src/client/AgentPresetSeat.tsx'
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

describe('the new-session mode switcher', () => {
  it('reads the roster once and shows the staged mode checked with its sentence', async () => {
    const actions = renderSeat()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    screen.getByRole('radiogroup', { name: 'Agent mode' })
    expect(screen.getByRole('radio', { name: en.presetStandardName }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
  })

  it('orders shipped modes first, placeholders next, authored presets last', () => {
    renderSeat({
      current: 'ptc',
      options: [
        { id: 'mine', trust: 'user' },
        { id: 'cordis', trust: 'system' },
        { id: 'ptc', trust: 'system' },
        { id: 'standard', trust: 'system' },
      ],
    })

    const names = screen.getAllByRole('radio').map(radio => radio.getAttribute('aria-label') ?? radio.textContent)
    expect(names).toEqual([
      en.presetStandardName,
      en.presetPtcName,
      en.presetCordisName,
      en.presetArmyName,
      en.presetMaestroName,
      'mine',
    ])
    expect(screen.getByRole('radio', { name: en.presetPtcName }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: en.presetArmyName })).toHaveProperty('disabled', true)
    expect(screen.getByRole('radio', { name: en.presetMaestroName })).toHaveProperty('disabled', true)
  })

  it('falls back to the id when the staged preset published no name', () => {
    renderSeat({ current: 'mine' })

    expect(screen.getByRole('radio', { name: 'mine' }).getAttribute('aria-checked')).toBe('true')
  })

  it('checks nothing while the staged id is absent from the roster', () => {
    renderSeat({ current: 'arriving' })

    expect(screen.queryByRole('radio', { checked: true })).toBeNull()
  })

  it('stages the picked preset on click', () => {
    const actions = renderSeat()

    fireEvent.click(screen.getByRole('radio', { name: 'mine' }))

    expect(actions.select).toHaveBeenCalledWith('mine')
  })

  it('disables every pill while a switch is in flight', () => {
    renderSeat({ busy: true })

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveProperty('disabled', true)
    }
  })

  it('gives every pill its own glyph', () => {
    renderSeat()
    const group = within(screen.getByRole('radiogroup', { name: 'Agent mode' }))
    for (const name of [en.presetStandardName, en.presetArmyName, en.presetMaestroName, 'mine']) {
      expect(group.getByRole('radio', { name }).querySelector('svg')).toBeTruthy()
    }
  })

  it('previews the hovered pill sentence and settles back on the staged one', () => {
    renderSeat()

    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    // React synthesizes enter/leave from over/out pairs, so the test speaks
    // that pair rather than bare enter/leave events.
    fireEvent.mouseOver(screen.getByRole('radio', { name: en.presetMaestroName }))
    expect(screen.getByText(en.presetMaestroDescription)).toBeTruthy()
    fireEvent.mouseOut(screen.getByRole('radiogroup', { name: 'Agent mode' }))
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
  })

  it('renders nothing before the roster arrives or when there is none', () => {
    const empty = renderSeat({ options: [] })
    expect(empty).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    cleanup()

    renderSeat({ current: '' })
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('acknowledges the introduce cue at once instead of animating it', () => {
    const actions = renderSeat({ introduce: true })

    expect(actions.introduced).toHaveBeenCalledTimes(1)
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

      fireEvent.click(screen.getByRole('radio', { name: 'mine' }))

      // The host refuses a mount discovery reported healthy, so this banner is
      // the only place the cause appears — the row has already reverted and
      // the settings row shows the preset as fine.
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

    fireEvent.click(screen.getByRole('radio', { name: 'mine' }))

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

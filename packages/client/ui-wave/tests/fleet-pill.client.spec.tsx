// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@greeneek/gnk-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {} from '../src/client/index.ts'
import { FleetPill } from '../src/client/FleetPill.tsx'
import { en } from '../src/client/locales.ts'
import {
  WAVE_TWO, emptySnapshot, fleetProps, fleetSource, fleetVerbs, liveSnapshot, loadingSnapshot, settledSnapshot, wave,
} from './fleet-surface-fixture.client.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Render the pill over a scripted mirror and verbs. */
function setup(initial = liveSnapshot()) {
  const source = fleetSource(initial)
  const verbs = fleetVerbs()
  const view = render(<FleetPill {...fleetProps(source, verbs)} />)
  return { view, source, verbs }
}

/** The disclosure trigger, addressed by the name it carries. */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: en['pill.open.aria'] })
}

describe('FleetPill presence', () => {
  it('renders nothing until a sample lists a wave', () => {
    const { view, source } = setup(loadingSnapshot())
    expect(view.container.textContent).toBe('')
    act(() => { source.set(emptySnapshot()) })
    expect(view.container.textContent).toBe('')
  })

  it('stays visible while the view is stale, naming itself as stale', () => {
    const { source } = setup()
    act(() => { source.set({ ...liveSnapshot(), degraded: true }) })
    expect(trigger().textContent).toContain(en['pill.label.degraded'].replace('{label}', 'docs pass'))
  })

  it('counts the members a stop could still reach', () => {
    setup()
    expect(trigger().textContent).toContain(
      en['pill.label'].replace('{label}', 'docs pass').replace('{running}', '1'),
    )
  })

  it('names the newest open wave when several are listed', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [wave(), wave({ waveId: WAVE_TWO, label: 'later pass', closed: true })],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(trigger().textContent).toContain('docs pass')
  })
})

describe('FleetPill overlay', () => {
  it('opens the fleet body on demand and samples again for the reader', () => {
    const { verbs } = setup()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger())
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText(en['stop.all'])).toBeDefined()
    expect(verbs.refresh.mock.calls.length).toBeGreaterThan(1)
  })

  it('closes on Escape, on the close control, and on a pointer outside', () => {
    const { view } = setup()
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: en['pill.close.aria'] }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger())
    act(() => {
      fireEvent.pointerDown(view.baseElement)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes itself when the fleet it was showing empties', () => {
    const { source } = setup()
    fireEvent.click(trigger())
    expect(screen.getByRole('dialog')).toBeDefined()
    act(() => { source.set(emptySnapshot()) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and ignores what does not close it', () => {
    const { view } = setup()
    // Escape while the overlay is closed has nothing to dismiss.
    fireEvent.keyDown(view.container.firstElementChild as HTMLElement, { key: 'Escape' })
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' })
    expect(screen.getByRole('dialog')).toBeDefined()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('FleetPill emergency stop', () => {
  it('offers the stop only while something is still running', () => {
    const { source } = setup(settledSnapshot())
    expect(screen.queryByRole('button', { name: en['pill.stop.aria'] })).toBeNull()
    act(() => { source.set(liveSnapshot()) })
    expect(screen.getByRole('button', { name: en['pill.stop.aria'] })).toBeDefined()
  })

  it('requires a confirming second click and reports the answer', async () => {
    const { verbs } = setup()
    const stop = screen.getByRole('button', { name: en['pill.stop.aria'] })
    fireEvent.click(stop)
    expect(verbs.stopAll).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['stop.all.confirm'] }))
    })
    expect(verbs.stopAll).toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe(en['stop.stopped'])
  })

  it('reports a refused stop with the Host message and code', async () => {
    const { verbs } = setup()
    verbs.stopAll.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'no host', {}) })
    const stop = screen.getByRole('button', { name: en['pill.stop.aria'] })
    fireEvent.click(stop)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['stop.all.confirm'] }))
    })
    expect(screen.getByRole('status').textContent).toBe(
      en['stop.failed'].replace('{message}', 'no host').replace('{code}', 'gateway/internal'),
    )
  })

  it('disarms a stop the reader never confirmed', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: en['pill.stop.aria'] }))
    expect(screen.getByRole('button', { name: en['stop.all.confirm'] })).toBeDefined()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(screen.getByRole('button', { name: en['pill.stop.aria'] })).toBeDefined()
  })
})

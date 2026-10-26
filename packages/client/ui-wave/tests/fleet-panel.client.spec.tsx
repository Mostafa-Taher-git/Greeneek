// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@greeneek/gnk-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {} from '../src/client/index.ts'
import { FleetPanel } from '../src/client/FleetPanel.tsx'
import { en } from '../src/client/locales.ts'
import {
  CHILD, MEMBER, MEMBER_TWO, WAVE, WAVE_TWO, emptySnapshot, fleetProps, fleetSource, fleetVerbs,
  liveSnapshot, loadingSnapshot, member, settledSnapshot, wave,
} from './fleet-surface-fixture.client.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Render the panel over a scripted mirror and verbs. */
function setup(initial = liveSnapshot()) {
  const source = fleetSource(initial)
  const verbs = fleetVerbs()
  render(<FleetPanel {...fleetProps(source, verbs)} />)
  return { source, verbs }
}

describe('FleetPanel states', () => {
  it('asks for a sample as soon as the tab mounts', () => {
    const { verbs } = setup()
    expect(verbs.refresh).toHaveBeenCalled()
  })

  it('explains a fleet that has not been sampled yet', () => {
    setup(loadingSnapshot())
    expect(screen.getByText(en['panel.loading'])).toBeDefined()
  })

  it('explains a session with no fleet, and says so differently when the host is unreachable', () => {
    const { source } = setup(emptySnapshot())
    expect(screen.getByText(en['panel.empty'])).toBeDefined()
    act(() => { source.set(emptySnapshot(true)) })
    expect(screen.getByText(en['panel.degraded'])).toBeDefined()
  })

  it('keeps the stale rows and warns above them when the next sample failed', () => {
    const { source } = setup()
    act(() => { source.set({ ...liveSnapshot(), degraded: true }) })
    expect(screen.getAllByText(en['panel.degraded'])).toHaveLength(1)
    expect(screen.getByText('docs pass')).toBeDefined()
  })
})

describe('FleetPanel rows', () => {
  it('lists the wave with its live member, status, and tokens', () => {
    setup()
    expect(screen.getByText('docs pass')).toBeDefined()
    expect(screen.getByText(en['wave.members'].replace('{count}', '1'))).toBeDefined()
    expect(screen.getByText('writer')).toBeDefined()
    expect(screen.getAllByText(en['status.running']).length).toBeGreaterThan(0)
    expect(screen.getByText(en['tokens'].replace('{tokens}', '120'))).toBeDefined()
  })

  it('names the provider when the spec carried no role, and shows the model and diagnostic when present', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [wave({
          members: [member({ role: undefined, provider: 'fork', model: 'flash', diagnostic: 'budget cut' })],
        })],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.getByText('fork')).toBeDefined()
    expect(screen.getByText('flash')).toBeDefined()
    expect(screen.getByTitle('budget cut')).toBeDefined()
  })

  it('shows the last tool and a settled duration only when the view carries them', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [wave({
          members: [
            member({ memberId: MEMBER, lastTool: 'bash', durationMs: 250 }),
            member({ memberId: MEMBER_TWO, lastTool: 'read', durationMs: 1_500 }),
          ],
        })],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.getByText('bash')).toBeDefined()
    expect(screen.getByTitle(en['lastTool'].replace('{tool}', 'bash'))).toBeDefined()
    expect(screen.getByText(en['duration.milliseconds'].replace('{milliseconds}', '250'))).toBeDefined()
    expect(screen.getByText(en['duration.seconds'].replace('{seconds}', '2'))).toBeDefined()
  })

  it('reads a metered spend against the wave ceiling in place of the plain token count', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [wave({ members: [member({ tokensUsed: 44, budgetUsed: 40, budgetLimit: 100 })] })],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.getByText(en['budget'].replace('{used}', '40').replace('{cap}', '100'))).toBeDefined()
    expect(screen.queryByText(en['tokens'].replace('{tokens}', '44'))).toBeNull()
    expect(screen.getByRole('button', { name: `${en['stop.member']}: writer · ${en['status.running']} · 40 / 100 tok` })).toBeDefined()
  })

  it('marks a settled wave closed and offers its child transcript instead of a stop', () => {
    const { verbs } = setup(settledSnapshot())
    expect(screen.getByText(en['wave.closed'])).toBeDefined()
    expect(screen.queryByText(en['stop.wave'])).toBeNull()
    expect(screen.queryByText(en['stop.member'])).toBeNull()
    fireEvent.click(screen.getByText(en['open.child']))
    expect(verbs.openChild).toHaveBeenCalledWith(CHILD)
  })

  it('stops a whole wave and confirms the issued stop', async () => {
    const { verbs } = setup()
    await act(async () => {
      fireEvent.click(screen.getByText(en['stop.wave']))
    })
    expect(verbs.stopWave).toHaveBeenCalledWith(WAVE)
    expect(screen.getByRole('status').textContent).toBe(en['stop.stopped'])
  })

  it('cancels one member, reporting a refused stop with its code', async () => {
    const { source, verbs } = setup()
    await act(async () => {
      verbs.stopMember.mockResolvedValue({
        ok: false,
        error: new RemoteError('gateway/internal', 'gone', {}),
      })
      source.set({
        ...liveSnapshot(),
        waveViews: [wave({ members: [member({ memberId: MEMBER_TWO, status: 'completed' }), member()] })],
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${en['stop.member']}: writer · ${en['status.running']} · 120 tok` }))
    })
    expect(verbs.stopMember).toHaveBeenCalledWith(WAVE, MEMBER)
    expect(screen.getByRole('status').textContent).toBe(
      en['stop.failed'].replace('{message}', 'gone').replace('{code}', 'gateway/internal'),
    )
  })

  it('stops the whole fleet only after a confirming second click', async () => {
    const { verbs } = setup()
    fireEvent.click(screen.getByText(en['stop.all']))
    expect(verbs.stopAll).not.toHaveBeenCalled()
    expect(screen.getByText(en['stop.all.confirm'])).toBeDefined()

    await act(async () => {
      fireEvent.click(screen.getByText(en['stop.all.confirm']))
    })
    expect(verbs.stopAll).toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe(en['stop.stopped'])
  })

  it('disarms an unconfirmed stop after its window passes', () => {
    setup()
    fireEvent.click(screen.getByText(en['stop.all']))
    expect(screen.getByText(en['stop.all.confirm'])).toBeDefined()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(screen.getByText(en['stop.all'])).toBeDefined()
  })

  it('disables the emergency stop once nothing is left to cancel', () => {
    setup(settledSnapshot())
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['stop.all'] }).disabled).toBe(true)
  })
})

describe('FleetPanel multi-wave', () => {
  it('renders one section per wave in face order', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [
          wave({ label: 'first' }),
          wave({ waveId: WAVE_TWO, label: 'second', closed: true, members: [member({ status: 'failed' })] }),
        ],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.getByText('first')).toBeDefined()
    expect(screen.getByText('second')).toBeDefined()
    expect(screen.getByText(en['status.failed'])).toBeDefined()
    expect(screen.getAllByText(en['wave.members'].replace('{count}', '1'))).toHaveLength(2)
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@greeneek/gnk-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FleetSnapshot, ResumeOutcome } from '../src/client/contract.ts'
import type {} from '../src/client/index.ts'
import { FleetPanel } from '../src/client/FleetPanel.tsx'
import { en } from '../src/client/locales.ts'
import {
  CHILD, MEMBER, MEMBER_TWO, SESSION, WAVE, WAVE_TWO, emptySnapshot, fleetProps, fleetSource, fleetVerbs,
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

  it('names the provider when the spec carried no role, and keeps the model and diagnostic in the drawer', () => {
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
    // The compact row carries neither; both wait for the drawer.
    expect(screen.queryByText('flash')).toBeNull()
    fireEvent.click(screen.getByText('fork'))
    expect(screen.getByText('flash')).toBeDefined()
    expect(screen.getByText('budget cut')).toBeDefined()
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

  it('marks a settled wave closed and offers its child transcript from the drawer instead of a stop', () => {
    const { verbs } = setup(settledSnapshot())
    expect(screen.getByText(en['wave.closed'])).toBeDefined()
    expect(screen.queryByText(en['stop.wave'])).toBeNull()
    expect(screen.queryByText(en['stop.member'])).toBeNull()
    expect(screen.queryByText(en['open.child'])).toBeNull()
    fireEvent.click(screen.getByText('writer'))
    fireEvent.click(screen.getByText(en['open.child']))
    expect(verbs.openChild).toHaveBeenCalledWith(CHILD)
  })

  it('stops a whole wave and confirms the issued stop', async () => {
    const { verbs } = setup()
    await act(async () => {
      fireEvent.click(screen.getByText(en['stop.wave']))
    })
    expect(verbs.stopWave).toHaveBeenCalledWith(WAVE)
    expect(screen.getByText(en['stop.stopped'])).toBeDefined()
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
    expect(screen.getByText(
      en['stop.failed'].replace('{message}', 'gone').replace('{code}', 'gateway/internal'),
    )).toBeDefined()
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
    expect(screen.getByText(en['stop.stopped'])).toBeDefined()
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

describe('FleetPanel resume card', () => {
  /** A closed wave whose reviewer lost its member budget, writer completed. */
  function budgetKillSnapshot(): FleetSnapshot {
    return {
      waveViews: [wave({
        closed: true,
        members: [
          member({ status: 'completed', tokensUsed: 400 }),
          member({ memberId: MEMBER_TWO, role: 'reviewer', status: 'budget-killed', diagnostic: 'member token budget exceeded' }),
        ],
      })],
      stoppable: false,
      degraded: false,
      loading: false,
    }
  }

  it('offers a resume card only for a closed budget-interrupted wave', () => {
    const { source } = setup(budgetKillSnapshot())
    expect(screen.getByText(en['resume.remaining'].replace('{members}', 'reviewer'))).toBeDefined()
    expect(screen.getByText(en['resume.budget.member'])).toBeDefined()
    expect(screen.getByText(en['resume.budget.wave'])).toBeDefined()

    // The action waits for at least one budget.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['resume.action'] }).disabled).toBe(true)

    // An open wave, an all-completed wave, and an already-resumed wave get no card.
    act(() => {
      source.set({
        waveViews: [
          wave({ waveId: 'wave-open' as typeof WAVE, label: 'open with kill', members: [member({ status: 'budget-killed' })] }),
          wave({ waveId: WAVE_TWO, label: 'all completed', closed: true, members: [member({ status: 'completed' })] }),
          wave({
            waveId: 'wave-resumed' as typeof WAVE,
            label: 'already resumed',
            closed: true,
            resumedToWaveId: WAVE_TWO,
            members: [member({ status: 'budget-killed' })],
          }),
        ],
        stoppable: false,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.queryByText(en['resume.action'])).toBeNull()
  })

  it('resumes with the entered budgets and announces the admission', async () => {
    const { verbs } = setup(budgetKillSnapshot())
    fireEvent.change(screen.getByLabelText(en['resume.budget.member']), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText(en['resume.budget.wave']), { target: { value: '500' } })
    await act(async () => {
      fireEvent.click(screen.getByText(en['resume.action']))
    })
    expect(verbs.resume).toHaveBeenCalledWith(WAVE, 40, 500)
    expect(screen.getByText(en['resume.started'])).toBeDefined()
  })

  it('keeps the action disabled while the admission is in flight', async () => {
    const { verbs } = setup(budgetKillSnapshot())
    let settle: ((outcome: ResumeOutcome) => void) | undefined
    verbs.resume.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    fireEvent.change(screen.getByLabelText(en['resume.budget.member']), { target: { value: '40' } })
    await act(async () => {
      fireEvent.click(screen.getByText(en['resume.action']))
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['resume.action'] }).disabled).toBe(true)
    settle?.({ ok: true, value: { waveId: WAVE_TWO } })
    await act(async () => {})
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['resume.action'] }).disabled).toBe(false)
  })

  it('reports a refused resume with its code', async () => {
    const { verbs } = setup(budgetKillSnapshot())
    verbs.resume.mockResolvedValue({
      ok: false,
      error: new RemoteError('wave/not-resumable', 'not resumable', { waveId: WAVE }),
    })
    fireEvent.change(screen.getByLabelText(en['resume.budget.wave']), { target: { value: '500' } })
    await act(async () => {
      fireEvent.click(screen.getByText(en['resume.action']))
    })
    expect(verbs.resume).toHaveBeenCalledWith(WAVE, undefined, 500)
    expect(screen.getByText(
      en['resume.failed'].replace('{message}', 'not resumable').replace('{code}', 'wave/not-resumable'),
    )).toBeDefined()
  })

  it('hides the card once the poll carries the resumed-to mark', async () => {
    const { source } = setup(budgetKillSnapshot())
    fireEvent.change(screen.getByLabelText(en['resume.budget.member']), { target: { value: '40' } })
    await act(async () => {
      fireEvent.click(screen.getByText(en['resume.action']))
    })
    expect(screen.getByText(en['resume.started'])).toBeDefined()

    act(() => {
      source.set({
        waveViews: [
          wave({
            closed: true,
            resumedToWaveId: WAVE_TWO,
            members: [
              member({ status: 'completed', tokensUsed: 400 }),
              member({ memberId: MEMBER_TWO, role: 'reviewer', status: 'budget-killed', diagnostic: 'member token budget exceeded' }),
            ],
          }),
          wave({
            waveId: WAVE_TWO,
            label: 'docs pass',
            parentSessionId: SESSION,
            closed: false,
            members: [member({ memberId: MEMBER_TWO, role: 'reviewer', status: 'running' })],
          }),
        ],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.queryByText(en['resume.action'])).toBeNull()
    expect(screen.getByText(en['status.running'])).toBeDefined()
  })
})

describe('FleetPanel member drawer', () => {
  /** A fleet with two members, so one-at-a-time has something to contradict. */
  function pairSnapshot(): FleetSnapshot {
    return {
      waveViews: [wave({
        members: [member(), member({ memberId: MEMBER_TWO, role: 'reviewer', status: 'queued' })],
      })],
      stoppable: true,
      degraded: false,
      loading: false,
    }
  }

  it('opens one drawer at a time from the row toggle', () => {
    setup(pairSnapshot())
    const rowToggle = (name: string): HTMLElement | null =>
      screen.getByText(name).closest('button')
    expect(rowToggle('writer')?.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(en['drawer.provider'])).toBeNull()

    fireEvent.click(screen.getByText('writer'))
    expect(rowToggle('writer')?.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(en['drawer.provider'])).toBeDefined()
    expect(screen.getByText('spawn')).toBeDefined()

    fireEvent.click(screen.getByText('reviewer'))
    expect(rowToggle('reviewer')?.getAttribute('aria-expanded')).toBe('true')
    expect(rowToggle('writer')?.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByText(en['drawer.provider'])).toHaveLength(1)
  })

  it('toggles closed on a second click', () => {
    setup()
    fireEvent.click(screen.getByText('writer'))
    expect(screen.getByText(en['drawer.provider'])).toBeDefined()
    fireEvent.click(screen.getByText('writer'))
    expect(screen.queryByText(en['drawer.provider'])).toBeNull()
  })

  it('carries the model, the full diagnostic, and the artifact addresses', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [wave({
          members: [member({
            status: 'completed',
            model: 'flash',
            diagnostic: 'budget cut',
            artifacts: [
              { kind: 'file', path: 'src/answer.ts' },
              { kind: 'uri', uri: 'https://example.com/report' },
            ],
          })],
        })],
        stoppable: false,
        degraded: false,
        loading: false,
      })
    })
    fireEvent.click(screen.getByText('writer'))
    expect(screen.getByText(en['drawer.model'])).toBeDefined()
    expect(screen.getByText('flash')).toBeDefined()
    expect(screen.getByText(en['drawer.diagnostic'])).toBeDefined()
    expect(screen.getByText('budget cut')).toBeDefined()
    expect(screen.getByText(en['drawer.artifacts'])).toBeDefined()
    expect(screen.getByText('src/answer.ts')).toBeDefined()
    expect(screen.getByText('https://example.com/report')).toBeDefined()
  })
})

describe('FleetPanel announcements', () => {
  it('stays silent about the fleet the panel opened on', () => {
    setup(liveSnapshot())
    expect(screen.queryByText(en['announce.wave.started'].replace('{label}', 'docs pass'))).toBeNull()
  })

  it('announces a wave that arrives after the panel opened, but not one that arrives closed', () => {
    const { source } = setup(emptySnapshot())
    act(() => { source.set(liveSnapshot()) })
    expect(screen.getByText(en['announce.wave.started'].replace('{label}', 'docs pass'))).toBeDefined()

    act(() => {
      source.set({
        waveViews: [
          wave(),
          wave({
            waveId: WAVE_TWO,
            label: 'finished pass',
            closed: true,
            members: [member({ memberId: MEMBER_TWO, role: 'reviewer', status: 'failed' })],
          }),
        ],
        stoppable: true,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.queryByText(en['announce.wave.closed'].replace('{label}', 'finished pass'))).toBeNull()
    expect(screen.queryByText(`reviewer · ${en['status.failed']}`)).toBeNull()
  })

  it('announces a member the reader watched settle, and the wave closing beside it', () => {
    const { source } = setup()
    act(() => {
      source.set({
        waveViews: [wave({ closed: true, members: [member({ status: 'completed' })] })],
        stoppable: false,
        degraded: false,
        loading: false,
      })
    })
    expect(screen.getByText(
      `writer · ${en['status.completed']} · ${en['announce.wave.closed'].replace('{label}', 'docs pass')}`,
    )).toBeDefined()
  })

  it('tells a settled member once and narrates a wave the retention dropped again', () => {
    const { source } = setup()
    const settled = `writer · ${en['status.completed']}`
    const completedFleet = (): FleetSnapshot => ({
      waveViews: [wave({ members: [member({ status: 'completed' })] })],
      stoppable: false,
      degraded: false,
      loading: false,
    })
    act(() => { source.set(completedFleet()) })
    expect(screen.getByText(settled)).toBeDefined()

    // An identical sample repeats nothing.
    act(() => { source.set(completedFleet()) })
    expect(screen.getAllByText(settled)).toHaveLength(1)

    // The wave leaves the list; a re-listed wave narrates again.
    act(() => { source.set(emptySnapshot()) })
    act(() => { source.set(completedFleet()) })
    expect(screen.getByText(en['announce.wave.started'].replace('{label}', 'docs pass'))).toBeDefined()
  })
})

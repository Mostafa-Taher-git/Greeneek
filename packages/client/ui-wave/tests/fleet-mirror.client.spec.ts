import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { RemoteError } from '@greeneek/gnk-client-test-runtime'
import type { RemoteResult } from '@greeneek/gnk-typert-protocol'
import type { Context as ClientContext } from '@greeneek/cordis'
import type { WaveId, WaveMemberId, WaveMemberView, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import { FleetMirror, PUBLISH_WINDOW_MS } from '../src/client/fleet-mirror.ts'
import type { FleetSnapshot } from '../src/client/contract.ts'

const SESSION = 'lead-1' as SessionId
const WAVE = 'wave-1' as WaveId
const MEMBER = 'member-1' as WaveMemberId

/** One member row, varied only where a spec needs a different rendered field. */
function member(over: Partial<WaveMemberView> = {}): WaveMemberView {
  return {
    memberId: MEMBER,
    provider: 'spawn',
    role: 'writer',
    status: 'running',
    tokensUsed: 120,
    ...over,
  }
}

/** One wave view over the given members. */
function wave(over: Partial<WaveView> = {}): WaveView {
  return {
    waveId: WAVE,
    label: 'docs pass',
    parentSessionId: SESSION,
    closed: false,
    members: [member()],
    ...over,
  }
}

/** A `waves` Remote namespace whose answers a spec scripts per call. */
function wavesRemote(): {
  list: Mock<() => Promise<RemoteResult<readonly WaveView[]>>>
  cancelAll: Mock<() => Promise<RemoteResult<{ waveIds: readonly WaveId[] }>>>
  cancelWave: Mock<(waveId: WaveId) => Promise<RemoteResult<{ cancelled: true }>>>
  cancelMember: Mock<(waveId: WaveId, memberId: WaveMemberId) => Promise<RemoteResult<{ cancelled: true }>>>
} {
  return {
    list: vi.fn<() => Promise<RemoteResult<readonly WaveView[]>>>()
      .mockResolvedValue({ ok: true, value: [wave()] }),
    cancelAll: vi.fn<() => Promise<RemoteResult<{ waveIds: readonly WaveId[] }>>>()
      .mockResolvedValue({ ok: true, value: { waveIds: [WAVE] } }),
    cancelWave: vi.fn<(waveId: WaveId) => Promise<RemoteResult<{ cancelled: true }>>>()
      .mockResolvedValue({ ok: true, value: { cancelled: true } }),
    cancelMember: vi.fn<(waveId: WaveId, memberId: WaveMemberId) => Promise<RemoteResult<{ cancelled: true }>>>()
      .mockResolvedValue({ ok: true, value: { cancelled: true } }),
  }
}

/** Boot one mirror over a context carrying the scripted namespace. */
function bench(remote = wavesRemote()): { mirror: FleetMirror; remote: ReturnType<typeof wavesRemote> } {
  const ctx = { remote: { waves: remote } } as unknown as ClientContext
  return { mirror: new FleetMirror(ctx, SESSION), remote }
}

/** Advance past the mirror's coalescing window so a pending sample renders. */
async function flushWindow(): Promise<void> {
  await vi.advanceTimersByTimeAsync(PUBLISH_WINDOW_MS)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('FleetMirror sampling', () => {
  it('starts loading and publishes the first sample', async () => {
    const { mirror } = bench()
    const listener = vi.fn()
    mirror.subscribe(listener)
    expect(mirror.getSnapshot().loading).toBe(true)

    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()
    expect(mirror.getSnapshot()).toMatchObject({ loading: false, degraded: false, stoppable: true })
    expect(mirror.getSnapshot().waveViews).toHaveLength(1)
    expect(listener).toHaveBeenCalled()
    mirror.dispose()
  })

  it('keeps one snapshot identity while the fleet is unchanged', async () => {
    const { mirror, remote } = bench()
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()
    const first = mirror.getSnapshot()

    remote.list.mockResolvedValue({ ok: true, value: [wave()] })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot()).toBe(first)
    mirror.dispose()
  })

  it('republishes when a member moves and resamples every second while a wave is open', async () => {
    const { mirror, remote } = bench()
    const listener = vi.fn()
    mirror.subscribe(listener)
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()

    remote.list.mockResolvedValue({
      ok: true,
      value: [wave({ members: [member({ status: 'completed', tokensUsed: 400 })] })],
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().waveViews[0]?.members[0]?.tokensUsed).toBe(400)

    // Every member settled, so the wave closes and the loop drops to the idle
    // cadence: nothing at 1s, a sample at 5s.
    remote.list.mockResolvedValue({ ok: true, value: [wave({ closed: true })] })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().stoppable).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    const beforeIdle = remote.list.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)
    await flushWindow()
    expect(remote.list.mock.calls.length).toBeGreaterThan(beforeIdle)
    expect(mirror.getSnapshot().stoppable).toBe(false)
    mirror.dispose()
  })

  it('reports a rejected Remote result as degraded without dropping the last views', async () => {
    const { mirror, remote } = bench()
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()

    remote.list.mockResolvedValue({
      ok: false,
      error: new RemoteError('gateway/internal', 'host gone', {}),
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot()).toMatchObject({ degraded: true, loading: false })
    expect(mirror.getSnapshot().waveViews).toHaveLength(1)
    mirror.dispose()
  })

  it('reports an assembly fault as degraded and recovers on the next sample', async () => {
    const { mirror, remote } = bench()
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()

    remote.list.mockRejectedValueOnce(new Error('unmounted'))
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().degraded).toBe(true)

    remote.list.mockResolvedValue({ ok: true, value: [wave()] })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().degraded).toBe(false)
    mirror.dispose()
  })

  it('coalesces a burst of samples into one render whose state is the last sample', async () => {
    const { mirror, remote } = bench()
    const rendered: FleetSnapshot[] = []
    mirror.subscribe(() => { rendered.push(mirror.getSnapshot()) })
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()
    rendered.length = 0

    // Twenty samples answered inside one window: without coalescing each one
    // would notify its subscribers, and every reader would render a row that
    // the next sample replaces.
    for (let tokens = 1; tokens <= 20; tokens += 1) {
      remote.list.mockResolvedValueOnce({
        ok: true,
        value: [wave({ members: [member({ tokensUsed: tokens })] })],
      })
      mirror.refresh()
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(remote.list).toHaveBeenCalledTimes(21)
    expect(rendered).toHaveLength(0)

    await flushWindow()
    expect(rendered).toHaveLength(1)
    expect(rendered[0]?.waveViews[0]?.members[0]?.tokensUsed).toBe(20)
    expect(mirror.getSnapshot().waveViews[0]?.members[0]?.tokensUsed).toBe(20)
    mirror.dispose()
  })

  it('republishes when only a member row field moves', async () => {
    const { mirror, remote } = bench()
    const listener = vi.fn()
    mirror.subscribe(listener)
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()

    remote.list.mockResolvedValue({ ok: true, value: [wave({ members: [member({ lastTool: 'bash' })] })] })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().waveViews[0]?.members[0]?.lastTool).toBe('bash')

    remote.list.mockResolvedValue({
      ok: true,
      value: [wave({ members: [member({ lastTool: 'bash', budgetUsed: 40, budgetLimit: 100 })] })],
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().waveViews[0]?.members[0]).toMatchObject({ budgetUsed: 40, budgetLimit: 100 })

    remote.list.mockResolvedValue({
      ok: true,
      value: [wave({
        members: [member({ lastTool: 'bash', budgetUsed: 40, budgetLimit: 100, status: 'completed', durationMs: 250 })],
      })],
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().waveViews[0]?.members[0]?.durationMs).toBe(250)
    mirror.dispose()
  })

  it('collapses a second attention poll onto the sample already in flight', async () => {
    const { mirror, remote } = bench()
    let resolveList: ((value: { ok: true; value: readonly WaveView[] }) => void) | undefined
    remote.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve }))
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(remote.list).toHaveBeenCalledTimes(1)

    mirror.refresh()
    mirror.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(remote.list).toHaveBeenCalledTimes(1)

    resolveList?.({ ok: true, value: [wave()] })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot().loading).toBe(false)
    expect(remote.list.mock.calls.length).toBeGreaterThan(1)
    mirror.dispose()
  })

  it('stops sampling once no surface subscribes, and restarts on the next one', async () => {
    const { mirror, remote } = bench()
    const unsubscribe = mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(remote.list).toHaveBeenCalledTimes(1)

    unsubscribe()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remote.list).toHaveBeenCalledTimes(1)

    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(remote.list).toHaveBeenCalledTimes(2)
    mirror.dispose()
  })

  it('drops a sample that lands after the mirror is disposed', async () => {
    const { mirror, remote } = bench()
    let resolveList: ((value: { ok: true; value: readonly WaveView[] }) => void) | undefined
    remote.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve }))
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)

    mirror.dispose()
    resolveList?.({ ok: true, value: [wave({ label: 'late' })] })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mirror.getSnapshot().loading).toBe(true)
    expect(remote.list).toHaveBeenCalledTimes(1)
  })

  it('ignores an attention poll raised after disposal', async () => {
    const { mirror, remote } = bench()
    mirror.dispose()
    mirror.refresh()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remote.list).not.toHaveBeenCalled()
  })

  it('keeps one snapshot identity while the Host stays unreachable', async () => {
    const { mirror, remote } = bench()
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()
    remote.list.mockResolvedValue({
      ok: false,
      error: new RemoteError('gateway/internal', 'host gone', {}),
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    const degraded = mirror.getSnapshot()
    await vi.advanceTimersByTimeAsync(1_000)
    await flushWindow()
    expect(mirror.getSnapshot()).toBe(degraded)
    expect(remote.list).toHaveBeenCalledTimes(3)
    mirror.dispose()
  })

  it('keeps sampling while another surface still subscribes', async () => {
    const { mirror, remote } = bench()
    const unsubscribeFirst = mirror.subscribe(() => {})
    mirror.subscribe(() => {})
    unsubscribeFirst()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(remote.list.mock.calls.length).toBeGreaterThan(1)
    mirror.dispose()
  })

  it('holds the idle cadence for a settled fleet whose Host went unreachable', async () => {
    const { mirror, remote } = bench()
    remote.list.mockResolvedValue({ ok: true, value: [wave({ closed: true })] })
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await flushWindow()
    expect(mirror.getSnapshot().stoppable).toBe(false)

    remote.list.mockResolvedValue({
      ok: false,
      error: new RemoteError('gateway/internal', 'host gone', {}),
    })
    await vi.advanceTimersByTimeAsync(5_000)
    await flushWindow()
    expect(mirror.getSnapshot().degraded).toBe(true)
    const samples = remote.list.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)
    await flushWindow()
    expect(remote.list.mock.calls.length).toBe(samples + 1)
    mirror.dispose()
  })

  it('does nothing when the last subscriber leaves before any sample is queued', () => {
    const { mirror, remote } = bench()
    const unsubscribe = mirror.subscribe(() => {})
    unsubscribe()
    expect(remote.list).not.toHaveBeenCalled()
    mirror.dispose()
  })
})

describe('FleetMirror control verbs', () => {
  it('cancels a member and samples immediately after the Host answer', async () => {
    const { mirror, remote } = bench()
    mirror.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)

    await expect(mirror.stopMember(WAVE, MEMBER)).resolves.toEqual({ ok: true, value: { cancelled: true } })
    await vi.advanceTimersByTimeAsync(0)
    expect(remote.cancelMember).toHaveBeenCalledWith(WAVE, MEMBER)
    expect(remote.list).toHaveBeenCalledTimes(2)
    mirror.dispose()
  })

  it('cancels one wave and every wave of the session', async () => {
    const { mirror, remote } = bench()
    await expect(mirror.stopWave(WAVE)).resolves.toEqual({ ok: true, value: { cancelled: true } })
    await expect(mirror.stopAll()).resolves.toEqual({ ok: true, value: { waveIds: [WAVE] } })
    expect(remote.cancelWave).toHaveBeenCalledWith(WAVE)
    expect(remote.cancelAll).toHaveBeenCalledWith(SESSION)
    await vi.advanceTimersByTimeAsync(0)
    mirror.dispose()
  })

  it('leaves a disposed mirror unscheduled after a control verb answers', async () => {
    const { mirror, remote } = bench()
    remote.cancelWave.mockImplementation(() => Promise.resolve({ ok: true, value: { cancelled: true } }))
    mirror.dispose()
    const pending = mirror.stopWave(WAVE)
    await vi.advanceTimersByTimeAsync(0)
    await expect(pending).resolves.toEqual({ ok: true, value: { cancelled: true } })
    expect(remote.list).not.toHaveBeenCalled()
  })
})

/**
 * Shared fixture for the fleet surface specs: one mutable mirror source plus the
 * props the two surfaces read, so a spec changes the fleet by writing a snapshot
 * and flushing the subscribers.
 */
import { vi, type Mock } from 'vitest'
import type { HostObservable, PropsLocale } from '@greeneek/gnk-client-ui-slots'
import { bindSnapshotSelector, makeTranslate } from '@greeneek/gnk-client-test-runtime'
import type { WaveId, WaveMemberId, WaveMemberView, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import type {
  FleetInjected, FleetPanelProps, FleetSnapshot, ResumeOutcome, StopAllOutcome, StopOutcome,
} from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

export const SESSION = 'lead-1' as SessionId
export const WAVE = 'wave-1' as WaveId
export const WAVE_TWO = 'wave-2' as WaveId
export const MEMBER = 'member-1' as WaveMemberId
export const MEMBER_TWO = 'member-2' as WaveMemberId
export const CHILD = 'child-1' as SessionId

/** The snapshot a surface reads before any sample has landed. */
export function loadingSnapshot(): FleetSnapshot {
  return { waveViews: [], stoppable: false, degraded: false, loading: true }
}

/** The snapshot of a session with no wave at all. */
export function emptySnapshot(degraded = false): FleetSnapshot {
  return { waveViews: [], stoppable: false, degraded, loading: false }
}

/** Overrides that may clear a field by naming it `undefined`. */
type MemberOverrides = { [K in keyof WaveMemberView]?: WaveMemberView[K] | undefined }

/** One member row, with `undefined` fields dropped rather than carried. */
export function member(over: MemberOverrides = {}): WaveMemberView {
  const merged: MemberOverrides = {
    memberId: MEMBER,
    provider: 'spawn',
    role: 'writer',
    status: 'running',
    tokensUsed: 120,
    ...over,
  }
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as WaveMemberView
}

/** One wave row over the given members. */
export function wave(over: Partial<WaveView> = {}): WaveView {
  return { waveId: WAVE, label: 'docs pass', parentSessionId: SESSION, closed: false, members: [member()], ...over }
}

/** A settled fleet: one closed wave whose only member completed. */
export function settledSnapshot(): FleetSnapshot {
  return {
    waveViews: [wave({ closed: true, members: [member({ status: 'completed', childSessionId: CHILD })] })],
    stoppable: false,
    degraded: false,
    loading: false,
  }
}

/** A running fleet: one open wave with a live member. */
export function liveSnapshot(): FleetSnapshot {
  return { waveViews: [wave()], stoppable: true, degraded: false, loading: false }
}

/** A surface's mutable mirror, with the sample writer the spec drives. */
export interface FleetSource extends HostObservable<FleetSnapshot> {
  /** Replace the snapshot and notify every subscriber. */
  set(next: FleetSnapshot): void
}

/** Build one mutable fleet mirror. */
export function fleetSource(initial: FleetSnapshot): FleetSource {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: FleetSnapshot) => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Verbs a spec scripts, each recording its call and answer. */
export interface FleetVerbSpies {
  refresh: Mock<() => void>
  stopAll: Mock<() => Promise<StopAllOutcome>>
  stopWave: Mock<(waveId: WaveId) => Promise<StopOutcome>>
  stopMember: Mock<(waveId: WaveId, memberId: WaveMemberId) => Promise<StopOutcome>>
  resume: Mock<(waveId: WaveId, maxTokensPerMember?: number, maxWaveTokens?: number) => Promise<ResumeOutcome>>
  openChild: Mock<(childSessionId: SessionId) => void>
}

/** Script one success answer for every stop verb. */
export function fleetVerbs(): FleetVerbSpies {
  return {
    refresh: vi.fn<() => void>(),
    stopAll: vi.fn<() => Promise<StopAllOutcome>>()
      .mockResolvedValue({ ok: true, value: { waveIds: [WAVE] } }),
    stopWave: vi.fn<(waveId: WaveId) => Promise<StopOutcome>>()
      .mockResolvedValue({ ok: true, value: { cancelled: true } }),
    stopMember: vi.fn<(waveId: WaveId, memberId: WaveMemberId) => Promise<StopOutcome>>()
      .mockResolvedValue({ ok: true, value: { cancelled: true } }),
    resume: vi.fn<(waveId: WaveId, maxTokensPerMember?: number, maxWaveTokens?: number) => Promise<ResumeOutcome>>()
      .mockResolvedValue({ ok: true, value: { waveId: WAVE_TWO } }),
    openChild: vi.fn<(childSessionId: SessionId) => void>(),
  }
}

/** The English translator, so specs assert the copy shipped for `en`. */
export const t = makeTranslate(en) as unknown as PropsLocale<'fleet'>['t']

/**
 * Compose the props both fleet surfaces read.
 * @param source - the mutable mirror the spec drives.
 * @param verbs - the scripted stop verbs.
 * @returns props assignable to either surface.
 */
export function fleetProps(source: FleetSource, verbs: FleetVerbSpies): FleetPanelProps {
  const injected: FleetInjected = { hooks: { fleet: source }, ...verbs }
  return {
    sessionId: SESSION,
    t,
    useFleet: bindSnapshotSelector(source),
    ...injected,
    useSession: () => undefined,
    useProjection: () => undefined,
    useSessionPendingInteraction: () => undefined,
    useSessions: () => undefined,
    useWorkspaces: () => undefined,
  } as unknown as FleetPanelProps
}

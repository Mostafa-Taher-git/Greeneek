/**
 * Live-region announcements for the fleet surfaces: a wave arriving, a wave
 * closing, and members the reader watched reach a terminal status.
 *
 * The diff is ref-held and skip-first: the first non-loading sample folds in
 * silently, so a panel opened mid-flight does not narrate the fleet it found
 * already running. The sample transition lines join into one string for one
 * polite region — the reader hears one coherent sentence, not a burst.
 * @module @greeneek/gnk-client-ui-wave/client/use-announcements
 */
import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@greeneek/gnk-client-ui-slots'
import type { FleetSnapshot } from './contract.ts'
import { isTerminal, MEMBER_STATE } from './member-state.ts'

/** What one announcing surface has already told its reader. */
interface SeenState {
  /** The skip-first window is over: a sample has been folded in. */
  initialized: boolean
  /** Wave ids the surface has already shown, announced or folded in. */
  waves: Set<string>
  /** Wave ids already announced as closed (or folded in closed). */
  closed: Set<string>
  /** `waveId:memberId` keys already announced (or folded in) settled. */
  settled: Set<string>
}

/** An empty seen-state: nothing shown, nothing told. */
function initialSeen(): SeenState {
  return { initialized: false, waves: new Set(), closed: new Set(), settled: new Set() }
}

/** A wave-scoped settled key, so a wave's forget removes exactly its members. */
function settledKey(waveId: string, memberId: string): string {
  return `${waveId}:${memberId}`
}

/**
 * Diff one sample against what the surface already told. The first sample only
 * records — a panel opened mid-flight found this fleet, it is not news.
 * @param previous - the seen-state before this sample.
 * @param snapshot - the sample that just landed.
 * @param t - the fleet translator.
 * @returns the replacement seen-state and the lines this transition announces.
 */
function diffSeen(
  previous: SeenState,
  snapshot: FleetSnapshot,
  t: TranslateNS<'fleet'>,
): { seen: SeenState; lines: readonly string[] } {
  const announce = previous.initialized
  const seen: SeenState = {
    initialized: true,
    waves: new Set(previous.waves),
    closed: new Set(previous.closed),
    settled: new Set(previous.settled),
  }
  const lines: string[] = []
  const retained = new Set<string>()
  for (const wave of snapshot.waveViews) {
    retained.add(wave.waveId)
    if (!previous.waves.has(wave.waveId)) {
      seen.waves.add(wave.waveId)
      if (wave.closed) {
        seen.closed.add(wave.waveId)
      } else if (announce) {
        lines.push(t('announce.wave.started', { label: wave.label }))
      }
      if (!announce) {
        for (const member of wave.members) {
          if (isTerminal(member.status)) seen.settled.add(settledKey(wave.waveId, member.memberId))
        }
      }
      continue
    }
    for (const member of wave.members) {
      if (!isTerminal(member.status)) continue
      const key = settledKey(wave.waveId, member.memberId)
      if (seen.settled.has(key)) continue
      seen.settled.add(key)
      lines.push(`${member.role ?? member.provider} · ${t(MEMBER_STATE[member.status].label)}`)
    }
    if (wave.closed && !previous.closed.has(wave.waveId)) {
      seen.closed.add(wave.waveId)
      lines.push(t('announce.wave.closed', { label: wave.label }))
    }
  }
  // A wave the retention dropped is forgotten, so a re-listed wave narrates again.
  for (const id of previous.waves) {
    if (retained.has(id)) continue
    seen.waves.delete(id)
    seen.closed.delete(id)
    for (const key of seen.settled) {
      if (key.startsWith(`${id}:`)) seen.settled.delete(key)
    }
  }
  return { seen, lines }
}

/**
 * Track wave arrivals, closures, and member settlements across samples and
 * speak each transition's line. The seen-state rides a ref: the diff runs as an
 * effect over the snapshot the surface already subscribes to, and the region
 * renders the latest lines until the next transition replaces them.
 * @param snapshot - the live fleet mirror value the surface subscribes to.
 * @param t - the fleet translator.
 * @returns the current announcement, or the empty string while there is none.
 */
export function useAnnouncements(snapshot: FleetSnapshot, t: TranslateNS<'fleet'>): string {
  const [message, setMessage] = useState('')
  const seen = useRef<SeenState>(initialSeen())
  useEffect(() => {
    if (snapshot.loading) return
    const { seen: next, lines } = diffSeen(seen.current, snapshot, t)
    seen.current = next
    if (lines.length > 0) setMessage(lines.join(' · '))
  }, [snapshot, t])
  return message
}

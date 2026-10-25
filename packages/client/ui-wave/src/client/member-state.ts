/**
 * Member-status vocabulary the fleet surfaces share.
 * @module @greeneek/gnk-client-ui-wave/client/member-state
 */
import type { StateDotState } from '@greeneek/gnk-client-ui-primitives'
import type { WaveMemberStatus, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { FleetKey } from './locales.ts'

/**
 * Dot colour and copy per member status. A settled member is quiet: `done`
 * marks completed work, `error` marks work that did not finish as asked, and a
 * request-driven end (cancelled, budget-killed) takes `warning`.
 */
export const MEMBER_STATE: Readonly<Record<WaveMemberStatus, { dot: StateDotState; label: FleetKey }>> = {
  'queued': { dot: 'warning', label: 'status.queued' },
  'running': { dot: 'ongoing', label: 'status.running' },
  'completed': { dot: 'done', label: 'status.completed' },
  'failed': { dot: 'error', label: 'status.failed' },
  'cancelled': { dot: 'warning', label: 'status.cancelled' },
  'budget-killed': { dot: 'error', label: 'status.budgetKilled' },
}

/**
 * Whether the engine can still abort this member.
 * @param status - the member's current lifecycle state.
 * @returns true while the member is queued or running.
 */
export function isCancellable(status: WaveMemberStatus): boolean {
  return status === 'queued' || status === 'running'
}

/**
 * Count the members a stop could still reach across every listed wave.
 * @param views - the polled wave views.
 * @returns the number of queued or running members.
 */
export function runningMembers(views: readonly WaveView[]): number {
  return views.reduce((total, wave) => (
    total + wave.members.filter(member => isCancellable(member.status)).length
  ), 0)
}

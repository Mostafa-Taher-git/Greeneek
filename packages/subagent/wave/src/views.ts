/**
 * Browser-safe wave vocabulary: ids, member statuses, and the live fleet views
 * the Army surfaces render.
 *
 * This module is the whole of what a Client program may read of the engine. It
 * names no Agent, no start request, and no settled member output, because those
 * are Lead-facing values and reaching them would pull Host declarations — the
 * Session service among them — into the browser compilation face.
 * @module @greeneek/gnk-subagent-wave/views
 */
import type { Branded } from '@greeneek/gnk-brand'
import type { SessionId } from '@greeneek/gnk-session/types'

/** Identifies one accepted wave for its whole lifetime. */
export type WaveId = Branded<'WaveId'>

/**
 * Brand a string as a {@link WaveId}.
 * @param id - the raw wave id.
 * @returns the same string, branded.
 */
export function WaveId(id: string): WaveId {
  return id as WaveId
}

/** Identifies one member across its queue, run, and terminal record. */
export type WaveMemberId = Branded<'WaveMemberId'>

/**
 * Brand a string as a {@link WaveMemberId}.
 * @param id - the raw member id.
 * @returns the same string, branded.
 */
export function WaveMemberId(id: string): WaveMemberId {
  return id as WaveMemberId
}

/** Lifecycle state of one wave member. */
export type WaveMemberStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'budget-killed'

/** Live fleet row for one member, safe to render while the wave runs. */
export interface WaveMemberView {
  /** Stable member identity within the wave. */
  readonly memberId: WaveMemberId
  /** The spec's display role. */
  readonly role?: string
  /** Provider name from the spec. */
  readonly provider: string
  /** Current lifecycle state. */
  readonly status: WaveMemberStatus
  /** Published child session id; absent until the provider fulfills the run. */
  readonly childSessionId?: SessionId
  /** Child model tokens measured at the latest budget check. */
  readonly tokensUsed: number
  /** Provider model id when the request pinned one through agent options. */
  readonly model?: string
  /** Non-failure detail kept from a non-`completed` settlement. */
  readonly diagnostic?: string
  /**
   * Name of the child's most recent tool call. The engine subscribes to no
   * tool event, so no wave-side source fills this yet; a row must render it
   * only when present.
   */
  readonly lastTool?: string
  /**
   * Wall-clock milliseconds from launch to settlement. Absent before the member
   * launches and while it is still running, because no completed timestamp
   * exists yet; a queued member that never launched has no duration either.
   */
  readonly durationMs?: number
  /**
   * Pointer strings to artifacts the member's settled result named. The
   * subagent result carries no artifact vocabulary, so no source fills this
   * yet; the member drawer renders it only when present.
   */
  readonly artifacts?: readonly string[]
  /**
   * Tokens charged against the member budget by the `tokenUsage` projection.
   * Absent until the projection has metered at least one step; `tokensUsed`
   * stays the always-present cumulative count.
   */
  readonly budgetUsed?: number
}

/** A browser-visible wave snapshot. */
export interface WaveView {
  /** The wave's identity. */
  readonly waveId: WaveId
  /** The wave label from the request. */
  readonly label: string
  /** Parent session id the wave was started for. */
  readonly parentSessionId: SessionId
  /** Whether every member has settled. */
  readonly closed: boolean
  /** Live member rows in dispatch order. */
  readonly members: readonly WaveMemberView[]
}

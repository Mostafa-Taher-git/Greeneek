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

/**
 * One artifact a settled member named inside its own structured result. The
 * engine validates the pointer's shape and bounds before publishing it; a
 * member's prose output is never a pointer source.
 */
export interface WaveArtifactPointer {
  /** What the pointer addresses: a workspace file path or an HTTP(S) URI. */
  readonly kind: 'file' | 'uri'
  /** The path of a `file` pointer; absent on a `uri` pointer. */
  readonly path?: string
  /** The absolute HTTP(S) URI of a `uri` pointer; absent on a `file` pointer. */
  readonly uri?: string
}

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
   * Name of the last `tool/call` the child logged, which is the tool it is
   * running at the latest sample. Absent until the child logs one, and for a
   * child session this process does not hold (a remote provider). The engine
   * folds the child's own log, so the name is never one the child did not
   * dispatch.
   */
  readonly lastTool?: string
  /**
   * Wall-clock milliseconds from launch to settlement, the same value the
   * member's `wave/member-settled` record carries. Absent before the member
   * launches and while it is still running, because no settlement time exists
   * yet; a member cancelled while queued never launched and has no duration.
   */
  readonly durationMs?: number
  /**
   * Validated artifact pointers the member's settled structured result named
   * under its reserved `artifacts` property, in the child's order. Populated
   * only from that structured value — never from the member's prose output —
   * and only after the engine validated every pointer's shape and bounds;
   * absent until the member settles.
   */
  readonly artifacts?: readonly WaveArtifactPointer[]
  /**
   * Tokens charged against the member budget by the `tokenUsage` projection.
   * Absent until the projection has metered at least one step, and reached
   * through that projection's fold of the logged usage; `tokensUsed` stays the
   * always-present cumulative count.
   */
  readonly budgetUsed?: number
  /**
   * The wave's per-member token ceiling, which a row reads {@link budgetUsed}
   * against. Absent when the request set no `maxTokensPerMember`; the admitted
   * value is the one on the wave's `wave/initiated` record.
   */
  readonly budgetLimit?: number
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
  /**
   * The wave this one started for its unfinished members; absent until a
   * resume was admitted from this wave, and final once set — a wave resumes
   * at most once.
   */
  readonly resumedToWaveId?: WaveId
  /** Live member rows in dispatch order. */
  readonly members: readonly WaveMemberView[]
}

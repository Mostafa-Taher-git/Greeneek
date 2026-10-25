/**
 * Wave engine consumer-facing contracts: member requests, live views, and
 * settled results for `ctx.waves.startWave`. Cancellation, parentage, and
 * provider selection belong to the engine; this module is data only.
 *
 * @module @greeneek/gnk-subagent-wave/types
 */

import type { Branded } from '@greeneek/gnk-brand'
import type { Agent } from '@greeneek/gnk-agent'
import type { ContentBlock } from '@greeneek/gnk-llm'
import type { SessionId } from '@greeneek/gnk-session'
import type { SubagentStartRequest } from '@greeneek/gnk-subagent'
import type { SubagentStopReason } from '@greeneek/gnk-subagent'

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

/** One member's start-time ask; the engine supplies `parent` and `signal`. */
export type WaveMemberRequest = Omit<SubagentStartRequest, 'parent' | 'signal'>

/** What one wave member is asked to run. */
export interface WaveMemberSpec {
  /** Registry name of the subagent provider that will establish the child. */
  readonly provider: string
  /** Display role shown in the fleet; kept beside the id because views outlive the request. */
  readonly role?: string
  /** The one-shot start request minus engine-owned fields. */
  readonly request: WaveMemberRequest
}

/** What a caller asks the engine to run as one wave. */
export interface WaveRequest {
  /** The delegating Lead agent; owns the wave's lineage and durable records. */
  readonly parent: Agent
  /** Short fleet label for the whole wave. */
  readonly label: string
  /** Members in dispatch order; results return in this order. */
  readonly members: readonly WaveMemberSpec[]
  /**
   * When a member fails or is budget-killed, cancel every remaining active
   * member instead of letting siblings finish. Defaults to `continue-others`.
   */
  readonly onComplete?: 'continue-others' | 'fail-fast'
  /** Per-member token ceiling; a member exceeding it is killed at its next step boundary. */
  readonly maxTokensPerMember?: number
  /** Wave-aggregate token ceiling; breaching it kills every active member. */
  readonly maxWaveTokens?: number
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
}

/** One fleet row plus a capped preview of the member's terminal output. */
export interface WaveMemberResult extends WaveMemberView {
  /** The child's final assistant output, truncated to the configured byte cap. */
  readonly output: readonly ContentBlock[]
  /** True when the engine trimmed text or dropped an over-cap structured value. */
  readonly truncated: boolean
  /** The structured result when it satisfied the request schema and fit the cap. */
  readonly structured?: unknown
  /** Terminal stop reason; absent while the member has not settled. */
  readonly stopReason?: SubagentStopReason
}

/** The settled outcome of one wave. */
export interface WaveResult {
  /** The wave's identity. */
  readonly waveId: WaveId
  /**
   * `completed` when every member completed, `cancelled` when no member
   * completed and every member ended by cancellation, `partial` otherwise.
   */
  readonly outcome: 'completed' | 'partial' | 'cancelled'
  /** Every member's terminal record in dispatch order. */
  readonly members: readonly WaveMemberResult[]
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

/** Deployable wave-engine settings, changeable from cordis.yml. */
export interface WaveRuntimeConfig {
  /** Simultaneously launched (running) members across all waves; ceiling 16. */
  readonly maxConcurrent?: number
  /** UTF-8 byte cap applied to one member's settled output and structured value. */
  readonly maxResultBytes?: number
}

/** Fully-resolved engine configuration after defaulting. */
export interface ResolvedWaveConfig {
  /** See {@link WaveRuntimeConfig.maxConcurrent}. */
  readonly maxConcurrent: number
  /** See {@link WaveRuntimeConfig.maxResultBytes}. */
  readonly maxResultBytes: number
}

/**
 * Wave engine consumer-facing contracts: member requests, live views, and
 * settled results for `ctx.waves.startWave`. Cancellation, parentage, and
 * provider selection belong to the engine; this module is data only.
 *
 * @module @greeneek/gnk-subagent-wave/types
 */

import type { Agent } from '@greeneek/gnk-agent'
import type { ContentBlock } from '@greeneek/gnk-llm'
import type { SubagentStartRequest, SubagentStopReason } from '@greeneek/gnk-subagent'

import type { WaveArtifactPointer, WaveId, WaveMemberView } from './views.ts'

export { WaveId, WaveMemberId } from './views.ts'
export type { WaveArtifactPointer, WaveMemberStatus, WaveMemberView, WaveView } from './views.ts'

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

/**
 * Versioned engine seal over one member's settled result. Every field is
 * engine-owned — computed at the settlement funnel, never read from or
 * written by the member's model output — so a reader can tell the engine's
 * account of the settlement apart from the child's payload beside it.
 */
export interface WaveResultEnvelope {
  /** Contract version of this envelope's shape; bumps whenever it changes. */
  readonly schemaVersion: 1
  /** Engine wall-clock milliseconds when the member's result was sealed. */
  readonly heartbeatAt: number
  /** True when the engine capped output text or dropped an over-cap structured value. */
  readonly truncated: boolean
  /** Terminal stop reason; absent when the child never resolved a result. */
  readonly stopReason?: SubagentStopReason
  /**
   * Reserved for a future cross-process child identity. This engine version
   * never writes it; the named slot keeps that addition from being a format
   * change.
   */
  readonly externalSessionId?: string
  /**
   * Validated artifact pointers promoted from the member's own structured
   * result, in the child's order; absent when the member named none.
   */
  readonly artifacts?: readonly WaveArtifactPointer[]
}

/** One fleet row plus its capped payload and the engine's versioned seal. */
export interface WaveMemberResult extends WaveMemberView {
  /** The child's final assistant output, truncated to the configured byte cap. */
  readonly output: readonly ContentBlock[]
  /** The engine's settled-result seal; the member's budget spend stays on the inherited engine-owned `tokensUsed`/`budgetUsed` fields. */
  readonly envelope: WaveResultEnvelope
  /** The structured result when it satisfied the request schema and fit the cap. */
  readonly structured?: unknown
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

/**
 * Durable wave lifecycle records the engine appends to the Lead agent's
 * session log: one admission record before launch, one settlement record per
 * member, and one record that closes the wave. They are log-only records —
 * replay keeps them without contributing derived history — and same-repo
 * readers admit them through the generated persistence catalog; the engine
 * never derives a runtime decision from them.
 */
declare module '@greeneek/gnk-session/types' {
  interface SessionEventMap {
    /**
     * Durable record that one wave was admitted on this Lead session.
     * Appended before any member launches, so the log carries the wave's
     * identity, resolved policy, and membership even if the process tears
     * down before launch.
     */
    'wave/initiated': {
      /** The engine-minted wave id shared by every record of the wave. */
      waveId: string
      /** The Lead session the wave was admitted for. */
      parentSessionId: string
      /** The request's fleet label. */
      label: string
      /** The resolved completion policy. */
      onComplete: 'continue-others' | 'fail-fast'
      /** Per-member token ceiling of the request; absent when unset. */
      maxTokensPerMember?: number
      /** Wave-aggregate token ceiling of the request; absent when unset. */
      maxWaveTokens?: number
      /** How many members the wave admitted. */
      memberCount: number
      /** One row per member in dispatch order. */
      members: readonly {
        /** The engine-minted member id. */
        memberId: string
        /** The spec's registry provider name. */
        provider: string
        /** The spec's display role; absent when the spec omits it. */
        role?: string
      }[]
    }
    /**
     * Durable settlement record of exactly one wave member, appended once at
     * the single settlement funnel — by the member's own funnel or by the
     * closing wave, whichever runs first — so no member is written twice and
     * none is missed.
     */
    'wave/member-settled': {
      /** The engine-minted wave id shared by every record of the wave. */
      waveId: string
      /** The engine-minted member id. */
      memberId: string
      /** The member's dispatch index within the wave. */
      memberIndex: number
      /** The terminal settlement status; never `queued` or `running`. */
      status: 'completed' | 'failed' | 'cancelled' | 'budget-killed'
      /**
       * Cumulative child tokens at settlement, from the `tokenUsage`
       * projection; 0 for a member that was never metered or launched.
       */
      tokensUsed: number
      /**
       * Wall-clock launch-to-settlement milliseconds; absent when the member
       * never launched or settled through the wave's close before its own
       * funnel recorded an end time.
       */
      durationMs?: number
      /** Terminal detail when the settlement recorded one; absent otherwise. */
      diagnostic?: string
      /**
       * Validated artifact pointers the member's settled structured result
       * named; absent when it named none. Log-only mirror of the envelope's
       * `artifacts`, so a replayed log reconstructs what the Lead's report
       * carried.
       */
      artifacts?: readonly WaveArtifactPointer[]
    }
    /**
     * Durable record that one wave closed: it follows every member's
     * settlement record of the same wave id, and a member funnel arriving
     * after it writes nothing more, so it is the last `wave/*` record its
     * wave id ever receives.
     */
    'wave/settled': {
      /** The engine-minted wave id shared by every record of the wave. */
      waveId: string
      /**
       * `completed` when every member completed, `cancelled` when every
       * member ended by cancellation, `partial` otherwise.
       */
      outcome: 'completed' | 'partial' | 'cancelled'
      /** Every member's terminal row in dispatch order. */
      members: readonly {
        /** The engine-minted member id. */
        memberId: string
        /** The member's dispatch index within the wave. */
        memberIndex: number
        /** The terminal settlement status. */
        status: 'completed' | 'failed' | 'cancelled' | 'budget-killed'
        /** Cumulative child tokens at settlement; 0 when never metered. */
        tokensUsed: number
        /** Wall-clock launch-to-settlement milliseconds; absent when the member never launched. */
        durationMs?: number
        /** Terminal detail when the member's settlement recorded one; absent otherwise. */
        diagnostic?: string
        /**
         * Validated artifact pointers the member's settled structured result
         * named; absent when it named none. Same shape as the member's own
         * settlement record.
         */
        artifacts?: readonly WaveArtifactPointer[]
      }[]
    }
  }
}

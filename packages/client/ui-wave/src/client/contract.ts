/**
 * Army fleet surfaces contract: the live poll mirror, the shared inject face,
 * and the composed component props of the Fleet tab and the fallback pill.
 *
 * @module @greeneek/gnk-client-ui-wave/client/contract
 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { RemoteResult } from '@greeneek/gnk-typert-protocol'
import type { WaveId, WaveMemberId, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { SessionId } from '@greeneek/gnk-session/types'
// Type-only: pulls the context with the `waves` Remote namespace through the Client assembly.
import type {} from '@greeneek/gnk-api-remotes/client'
// Type-only: pulls the Session Controller service used for lead resolution and child opening.
import type {} from '@greeneek/gnk-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@greeneek/gnk-client-locale/client'

/**
 * One poll's fleet mirror for one Lead scope. `{ waveViews, stoppable }` are
 * the plan's named pair; `degraded`/`loading` give the panel its explanation
 * states without inventing a second source of truth.
 */
export interface FleetSnapshot {
  /** Wave views from the latest successful `waves/list` poll, in face order. */
  readonly waveViews: readonly WaveView[]
  /** True when at least one wave is still unclosed — the stop affordances bind. */
  readonly stoppable: boolean
  /** The last attempt failed to reach the `waves` remote; every view may be stale. */
  readonly degraded: boolean
  /** No poll has landed yet for this scope. */
  readonly loading: boolean
}

/** Cancel outcome for one wave or one member. */
export type StopOutcome = RemoteResult<{ cancelled: true }>

/** Emergency-stop outcome; the host answers with every wave id it owns. */
export type StopAllOutcome = RemoteResult<{ waveIds: readonly WaveId[] }>

/**
 * Fleet verbs and the live mirror, shared by the Fleet tab body and the
 * fallback pill (which renders the same body inside its overlay). All data is
 * plain values and callbacks closed over the plugin's ctx.
 */
export interface FleetInjected {
  hooks: {
    /**
     * Live fleet mirror of this scope's Lead, fed by the poll loop. A bare
     * observable the renderer binds to `useFleet`; the component never sees
     * the store handle itself.
     */
    fleet: HostObservable<FleetSnapshot>
  }
  /** One-shot attention poll (tab mount, pill overlay open); cadence rides the loop itself. */
  refresh: () => void
  /** Emergency stop — cancel every active member of every open wave. */
  stopAll: () => Promise<StopAllOutcome>
  /** Cancel one whole wave (its header affordance). */
  stopWave: (waveId: WaveId) => Promise<StopOutcome>
  /** Cancel one member (its row affordance, while queued or running). */
  stopMember: (waveId: WaveId, memberId: WaveMemberId) => Promise<StopOutcome>
  /** Open a member's child transcript through the current Session graph. */
  openChild: (childSessionId: SessionId) => void
}

/** Full props of the Fleet tab body, rendered inside the details panel. */
export type FleetPanelProps = PropsRuntime<'conversation.details.fleet'>
  & InjectFace<FleetInjected>
  & PropsLocale<'fleet'>

/** Full props of the composer-left fallback pill with its fleet overlay. */
export type FleetPillProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<FleetInjected>
  & PropsLocale<'fleet'>

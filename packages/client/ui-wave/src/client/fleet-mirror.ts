/**
 * Per-Lead-session fleet mirror: samples the `waves` Remote and publishes one
 * immutable {@link FleetSnapshot} to every mounted fleet surface.
 *
 * The engine keeps member progress in host memory and publishes no Remote
 * event for it, so a surface that shows live rows must re-read. One mirror per
 * session serves the details-panel Fleet tab and the composer pill together,
 * and the loop exists only while a surface subscribes to it: with no subscriber
 * the next scheduled sample is dropped instead of burning an RPC on a session
 * nobody is looking at. Accepted samples reach subscribers through an
 * {@link PUBLISH_WINDOW_MS} coalescing window, so a burst of samples is one
 * render and the last sample of the burst is the one that renders.
 * @module @greeneek/gnk-client-ui-wave/client/fleet-mirror
 */
import type { Context as ClientContext } from '@greeneek/cordis'
import { notifySubscribers } from '@greeneek/gnk-client-store'
import type { HostObservable } from '@greeneek/gnk-client-ui-slots'
import type { WaveId, WaveMemberId, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { SessionId } from '@greeneek/gnk-session/types'
// Type-only: pulls the context with the `waves` Remote namespace through the Client assembly.
import type {} from '@greeneek/gnk-api-remotes/client'
import type { FleetSnapshot, ResumeOutcome, StopAllOutcome, StopOutcome } from './contract.ts'

/** Cadence while at least one wave is unclosed. */
const LIVE_POLL_MS = 1_000

/** Cadence once every retained wave has settled: slow enough to be free, fast
 * enough that a fresh dispatch still appears without a user gesture. */
const IDLE_POLL_MS = 5_000

/**
 * Coalescing window for subscriber notifications. A burst of accepted samples
 * — several attention polls, several stop verbs, or a future pushed source —
 * renders once per window at most, and the last accepted snapshot flushes when
 * the window closes, so a surface never shows an intermediate row.
 */
export const PUBLISH_WINDOW_MS = 80

/** The mirror every fleet surface reads before its first sample lands. */
const INITIAL: FleetSnapshot = Object.freeze({
  waveViews: [],
  stoppable: false,
  degraded: false,
  loading: true,
})

/**
 * Structural signature of one poll result.
 *
 * Views arrive as freshly built arrays and objects on every sample, so
 * reference equality would republish an unchanged fleet once per second and
 * re-render every row. The fields any fleet surface renders are the fields the
 * mirror tracks.
 * @param views - the polled wave views.
 * @returns the value to compare against the previous sample.
 */
function signature(views: readonly WaveView[]): string {
  return views.map(wave => [
    wave.waveId, wave.label, wave.closed ? 1 : 0, wave.resumedToWaveId ?? '',
    wave.members.map(member => [
      member.memberId, member.status, member.tokensUsed, member.budgetUsed ?? '',
      member.budgetLimit ?? '', member.lastTool ?? '', member.durationMs ?? '',
      member.childSessionId ?? '', member.diagnostic ?? '',
      member.artifacts === undefined
        ? ''
        : member.artifacts.map(pointer => `${pointer.kind}:${pointer.path ?? pointer.uri ?? ''}`).join(','),
    ].join('|')).join(';'),
  ].join(':')).join(',')
}

/** Live fleet mirror of one Lead session, owned by the plugin's apply closure. */
export class FleetMirror implements HostObservable<FleetSnapshot> {
  /** The snapshot subscribers read; replaced only by a flush. */
  private snapshot: FleetSnapshot = INITIAL
  /** The last accepted snapshot, published at the next flush and used for cadence. */
  private latest: FleetSnapshot = INITIAL
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private inFlight = false
  private disposed = false

  /**
   * @param ctx - Client context carrying the `waves` Remote namespace.
   * @param sessionId - the Lead session whose fleet the mirror reports.
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly sessionId: SessionId,
  ) {}

  /** Return the published snapshot, unchanged until the coalescing window flushes. */
  getSnapshot = (): FleetSnapshot => this.snapshot

  /**
   * Subscribe to snapshot replacement and keep the sampling loop alive while
   * any subscriber remains.
   * @param listener - change callback.
   * @returns unsubscribe.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.schedule(0)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.cancel()
    }
  }

  /** Sample once now, for a surface that needs the fleet before the next tick. */
  refresh(): void {
    this.schedule(0)
  }

  /**
   * Emergency stop: abort every unsettled member of every wave of this session.
   * @returns the Remote outcome, with the Host's typed failure when the abort
   * could not be delivered.
   */
  async stopAll(): Promise<StopAllOutcome> {
    return await this.control(() => this.ctx.remote.waves.cancelAll(this.sessionId))
  }

  /**
   * Cancel one whole wave.
   * @param waveId - the target wave.
   * @returns the Remote outcome.
   */
  async stopWave(waveId: WaveId): Promise<StopOutcome> {
    return await this.control(() => this.ctx.remote.waves.cancelWave(waveId))
  }

  /**
   * Cancel one member.
   * @param waveId - the owning wave.
   * @param memberId - the target member.
   * @returns the Remote outcome.
   */
  async stopMember(waveId: WaveId, memberId: WaveMemberId): Promise<StopOutcome> {
    return await this.control(() => this.ctx.remote.waves.cancelMember(waveId, memberId))
  }

  /**
   * Resume one closed budget-interrupted wave under fresh explicit budgets.
   * The answer is the admission; the resumed wave's rows reach the surfaces
   * through the immediate sample this verb schedules.
   * @param waveId - the interrupted wave to resume.
   * @param maxTokensPerMember - the resumed wave's per-member ceiling.
   * @param maxWaveTokens - the resumed wave's aggregate ceiling.
   * @returns the Remote outcome carrying the resumed wave's id.
   */
  async resume(waveId: WaveId, maxTokensPerMember?: number, maxWaveTokens?: number): Promise<ResumeOutcome> {
    return await this.control(() => this.ctx.remote.waves.resume(waveId, maxTokensPerMember, maxWaveTokens))
  }

  /** Stop sampling and refuse further work when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.cancel()
    this.cancelFlush()
    this.listeners.clear()
  }

  /**
   * Run one control verb, then sample immediately so the mirror shows the
   * abort without waiting for the next tick.
   * @param call - the Remote invocation.
   * @returns the Remote outcome.
   */
  private async control<Outcome>(call: () => Promise<Outcome>): Promise<Outcome> {
    const outcome = await call()
    if (!this.disposed) this.schedule(0)
    return outcome
  }

  /** Queue a sample at `delayMs`, replacing any pending timer. */
  private schedule(delayMs: number): void {
    if (this.disposed) return
    this.cancel()
    this.timer = setTimeout(() => { void this.poll() }, delayMs)
  }

  /** Drop the pending sample. */
  private cancel(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * Read the fleet once, then arm the next sample. An unsettled wave resamples
   * at the live cadence and a fully settled fleet at the idle cadence, and a
   * failed sample still resamples: the mirror must recover on its own once the
   * Host answers again. A surface that unsubscribed mid-flight leaves no
   * follow-up behind.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      this.schedule(LIVE_POLL_MS)
      return
    }
    this.inFlight = true
    let views: readonly WaveView[] | undefined
    try {
      const carried = await this.ctx.remote.waves.list(this.sessionId)
      if (carried.ok) views = carried.value
    } catch {
      // The carrier's own throw is the same missing answer as a rejected
      // RemoteResult, so `views` stays undefined and one branch reports it.
    } finally {
      this.inFlight = false
    }
    // A surface that went away mid-flight leaves no publish and no follow-up.
    if (this.disposed) return
    if (views === undefined) {
      // A rejected RemoteResult and a carrier that threw are the same degraded
      // fact: the last rows stay, the reader learns they may be stale, and the
      // loop keeps running so the mirror recovers once the Host answers again.
      // An already-degraded mirror stays silent so its snapshot identity holds.
      if (this.latest.degraded && !this.latest.loading) {
        this.schedule(this.latest.stoppable ? LIVE_POLL_MS : IDLE_POLL_MS)
        return
      }
      this.accept({ ...this.latest, degraded: true, loading: false })
    } else if (signature(views) !== signature(this.latest.waveViews)) {
      this.accept({
        waveViews: views,
        stoppable: views.some(wave => !wave.closed),
        degraded: false,
        loading: false,
      })
    } else if (this.latest.degraded || this.latest.loading) {
      this.accept({ ...this.latest, degraded: false, loading: false })
    }
    this.schedule(this.latest.stoppable ? LIVE_POLL_MS : IDLE_POLL_MS)
  }

  /**
   * Take one sample as the mirror's current state and hand it to the
   * coalescing window; a window already open absorbs it, so a burst renders
   * once and the newest sample is the one that reaches subscribers.
   * @param snapshot - the sample to publish.
   */
  private accept(snapshot: FleetSnapshot): void {
    this.latest = snapshot
    this.flushTimer ??= setTimeout(() => { this.flush() }, PUBLISH_WINDOW_MS)
  }

  /** Publish the newest accepted snapshot and notify subscribers. */
  private flush(): void {
    this.flushTimer = undefined
    this.snapshot = Object.freeze(this.latest)
    notifySubscribers(this.listeners, '[ui-wave] fleet mirror')
  }

  /** Drop a pending flush; disposal keeps no work queued. */
  private cancelFlush(): void {
    if (this.flushTimer === undefined) return
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }
}

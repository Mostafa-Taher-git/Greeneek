/**
 * Stop-loop guard shared by the hook bridges: after that many consecutive
 * `Stop` blocks force continuation for the same turn, further blocks are
 * ignored so an unconditionally blocking hook cannot force the model step
 * forever. The cap matches Claude Code's documented stop-hook override
 * behavior; Codex documents no equivalent cap, so the bridges apply the same
 * bound rather than letting either dialect loop unboundedly.
 * @module @greeneek/gnk-hook-protocol/stop-guard
 */

/** Consecutive forced continuations allowed for one turn before the guard opens. */
export const MAX_STOP_FORCED_CONTINUATIONS = 8

interface StopCounts {
  /** The turn the consecutive count belongs to; a new turn restarts it. */
  turn: number
  /** How many times a `Stop` block forced continuation on that turn. */
  count: number
}

/**
 * Track consecutive `Stop` blocks per agent without retaining agent objects.
 * One guard serves both bridge listeners for a plugin instance: each bridge
 * keeps its own controller, so agent identity is the only per-agent state.
 */
export class StopLoopGuard {
  private readonly counts = new WeakMap<object, StopCounts>()

  /**
   * Admit one forced continuation for `agent` on `turn`.
   * @param agent - the agent whose turn keeps stopping.
   * @param turn - the open turn number on the agent's log.
   * @returns true when the continuation may proceed; false once the cap for
   *   the turn is exhausted (the caller lets the turn stop instead).
   */
  shouldContinue(agent: object, turn: number): boolean {
    const held = this.counts.get(agent)
    const count = held !== undefined && held.turn === turn ? held.count : 0
    if (count >= MAX_STOP_FORCED_CONTINUATIONS) return false
    this.counts.set(agent, { turn, count: count + 1 })
    return true
  }
}

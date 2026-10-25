/**
 * Abortable counting semaphore bounding concurrent wave-member launches. A
 * release hands its slot directly to the oldest still-live waiter, so queued
 * waiters never race a fresh `acquire` past the cap.
 *
 * @module @greeneek/gnk-subagent-wave/semaphore
 */

interface Waiter {
  readonly resolve: (acquire: () => void) => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal
  onAbort: () => void
}

/** Preserve Error abort reasons and wrap other caller-supplied values. */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Fixed-capacity asynchronous permit pool. */
export class Semaphore {
  private readonly waiters: Waiter[] = []
  private available: number

  /**
   * @param capacity - maximum simultaneously held permits; at least 1.
   */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`semaphore capacity must be an integer >= 1, got ${String(capacity)}`)
    }
    this.available = capacity
  }

  /**
   * Take one permit, waiting while the pool is exhausted.
   * @param signal - cancellation observed only while queued; a held permit is
   *   never revoked, and the listener is detached before a grant resumes the
   *   waiter, so a later abort cannot double-settle it.
   * @returns the release function; call it exactly once.
   * @throws the signal's Error abort reason when cancelled while (or before) queued;
   *   non-Error reasons are wrapped in an Error.
   */
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw abortReason(signal)
    if (this.available > 0 && this.waiters.length === 0) {
      this.available -= 1
      return this.grant()
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          reject(abortReason(signal))
        },
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  /** Hand out one permit; its release re-dequeues to the oldest live waiter. */
  private grant(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next === undefined) {
        this.available += 1
        return
      }
      next.signal.removeEventListener('abort', next.onAbort)
      next.resolve(this.grant())
    }
  }
}

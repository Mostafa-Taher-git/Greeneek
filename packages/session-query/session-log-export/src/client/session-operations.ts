/**
 * One in-flight browser operation per Session.
 *
 * The Session export surface runs two operations the same way: a repeated
 * gesture for the same Session joins the running one, a disposal aborts every
 * running operation, and the caller learns when the work settled. The two
 * controllers share this registry instead of repeating the bookkeeping.
 */
import type { SessionId } from '@greeneek/gnk-session/types'

/** One running operation and the handle that stops it. */
interface RunningOperation {
  readonly abort: AbortController
  readonly done: Promise<void>
}

/** Owns the running browser operations, one per Session. */
export class SessionOperationRegistry {
  private readonly active = new Map<SessionId, RunningOperation>()
  private disposed = false

  /**
   * Run one operation for a Session; a repeated gesture joins the running one.
   * @param sessionId - Session the operation belongs to.
   * @param body - the operation, with the signal that stops it.
   * @returns after the operation settles; a late request after disposal resolves at once.
   */
  run(sessionId: SessionId, body: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const existing = this.active.get(sessionId)
    if (existing !== undefined) return existing.done
    if (this.disposed) return Promise.resolve()
    const abort = new AbortController()
    const done = body(abort.signal).finally(() => {
      this.active.delete(sessionId)
    })
    this.active.set(sessionId, { abort, done })
    return done
  }

  /**
   * Abort every running operation and reach quiescence.
   * @returns after every operation settles.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const active = [...this.active.values()]
    for (const operation of active) operation.abort.abort()
    await Promise.allSettled(active.map(operation => operation.done))
  }
}

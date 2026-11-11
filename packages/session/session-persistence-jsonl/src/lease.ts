/**
 * Cross-process write-ownership lease for one session's artifact directory.
 *
 * Adapted from DeepSeek Harness `session-persistence-jsonl/src/lease.ts`
 * (MIT, HEAD `fcc0ad46`) — same shape (a lease held for the whole life of a
 * write handle, contention as `SessionAlreadyOwnedError`, kernel releases on
 * process death, no expiry that could expropriate a stalled writer) — but the
 * arbiter is an exclusive-create file carrying the holder pid instead of
 * upstream's native `flock`/Win32 semaphore, because Greeneek ships no
 * `node-addon-system` flock addon. A dead holder's pid is detected with
 * `process.kill(pid, 0)` and its stale file is reclaimed; a live holder
 * refuses. Readers never touch the lock; the lock file sits beside the log
 * and is removed on release.
 * @module gnk-session-persistence-jsonl/lease
 */

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionId } from '@greeneek/gnk-session'
import { SessionAlreadyOwnedError } from '@greeneek/gnk-session-persistence'

/** Base name of the lease file inside a session's directory. */
export const LEASE_FILENAME = 'session.lock'

/** Whether `pid` names a live process; dead, invalid, or missing pids are not held. */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM means the process exists but is not signalable: still alive.
    return (error as NodeJS.ErrnoException | null)?.code === 'EPERM'
  }
}

/** Read the holder pid from an existing lease file, or `undefined` when unreadable. */
function readHolder(path: string): number | undefined {
  try {
    const raw = readFileSync(path, 'utf8')
    const pid = Number(raw.trim().split('\n')[0]?.split(':')[0])
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

/**
 * One held write lease. Constructed only by {@link SessionWriteLease.acquire};
 * `release` removes the lease file when this process still owns it.
 */
export class SessionWriteLease {
  private released = false

  private constructor(
    private readonly lockPath: string,
    private readonly nonce: string,
  ) {}

  /**
   * Acquire the session directory's write lease.
   * @param dir - the session's artifact directory (created if absent).
   * @param id - the session the lease guards, for error identity.
   * @returns the held lease.
   * @throws {SessionAlreadyOwnedError} while another live holder keeps the lease.
   */
  static acquire(dir: string, id: SessionId): SessionWriteLease {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, LEASE_FILENAME)
    const nonce = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const fd = openSync(path, 'wx')
        try {
          writeSync(fd, `${nonce}\n`)
        } finally {
          closeSync(fd)
        }
        return new SessionWriteLease(path, nonce)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
        const holder = readHolder(path)
        if (holder === undefined || !isAlive(holder)) {
          // Stale: the holder died (or never wrote) without releasing.
          try {
            unlinkSync(path)
          } catch { /* the next attempt re-reads; a racing reclaimer wins the create */ }
          continue
        }
        throw new SessionAlreadyOwnedError(id)
      }
    }
    throw new SessionAlreadyOwnedError(id)
  }

  /** Release the lease by removing its file when this process still owns it. Idempotent. */
  release(): void {
    if (this.released) return
    this.released = true
    let holder: string | undefined
    try {
      holder = readFileSync(this.lockPath, 'utf8')
    } catch {
      holder = undefined
    }
    if (holder === undefined || !holder.startsWith(`${this.nonce}\n`)) return
    try {
      unlinkSync(this.lockPath)
    } catch { /* already reclaimed; release stays idempotent */ }
  }
}

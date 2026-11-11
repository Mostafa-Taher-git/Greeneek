/** Cross-process write lease: contention, stale reclaim, and release. */
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionAlreadyOwnedError } from '@greeneek/gnk-session-persistence'
import { SessionId } from '@greeneek/gnk-session'
import { SessionWriteLease, LEASE_FILENAME } from '../src/lease.ts'

const id = SessionId('lease-test')

describe('SessionWriteLease', () => {
  it('refuses a second live holder while the first holds the lease', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gnk-lease-'))
    const first = SessionWriteLease.acquire(dir, id)
    try {
      expect(() => SessionWriteLease.acquire(dir, id)).toThrow(SessionAlreadyOwnedError)
    } finally {
      first.release()
    }
    // After release, a new acquirer succeeds.
    const second = SessionWriteLease.acquire(dir, id)
    second.release()
  })

  it('reclaims a lease whose holder pid is dead and releases idempotently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gnk-lease-'))
    const lockPath = join(dir, LEASE_FILENAME)
    // 2^30 is not a live pid on any supported host.
    await writeFile(lockPath, '1073741824\n')
    const lease = SessionWriteLease.acquire(dir, id)
    lease.release()
    lease.release()
    const again = SessionWriteLease.acquire(dir, id)
    again.release()
  })
})

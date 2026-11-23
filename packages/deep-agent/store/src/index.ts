/**
 * Deep-agent authoritative SQLite store. One connection owns all writes;
 * SAVEPOINTs give nested rollback and afterCommit callbacks run only after
 * the outermost commit. The domain receives the same `Repositories` port as
 * the in-memory implementation.
 */
import type { DatabaseSync } from 'node:sqlite'
import type {
  Decision, Thread, Ticket, Trigger, TriggerDisposition,
} from '@greeneek/gnk-deep-agent-core'
import type { Repositories } from '@greeneek/gnk-deep-agent-core'
import { openDatabase } from './schema.ts'

export { DEEP_AGENT_SCHEMA_VERSION, DEEP_AGENT_OLDEST_SCHEMA, openDatabase } from './schema.ts'

/** One durable effect row. */
export interface EffectRow {
  readonly kind: string
  readonly key: string
  readonly value: string
  readonly seq: number
  readonly generation: number
  readonly attempts: number
  readonly error: string
  readonly due: string
  readonly since: string
}

/** One durable outbound receipt. */
export interface Receipt {
  readonly id: string
  readonly value: string
  readonly status: 'pending' | 'sent' | 'dropped'
  readonly dropped?: { readonly at: string; readonly reason: string }
}

function readValue(value: string): unknown {
  return JSON.parse(value) as unknown
}

/** SQLite-backed domain store with explicit lifecycle ownership. */
export class DeepAgentStore {
  private readonly db: DatabaseSync
  private depth = 0
  private pending: Array<() => void> = []
  private closing = false
  private seq = 0

  /** @param path - absolute database path; the parent directory is created owner-only. */
  constructor(path: string) {
    this.db = openDatabase(path)
    const last = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM effect').get() as { seq: number }
    this.seq = last.seq
  }

  /** Begin or nest a transaction. */
  atomic<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}_${this.seq++}`
    this.db.exec(`SAVEPOINT ${savepoint}`)
    this.depth += 1
    try {
      const result = fn()
      this.depth -= 1
      this.db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      if (this.depth === 0) {
        const callbacks = this.pending
        this.pending = []
        for (const callback of callbacks) callback()
      }
      return result
    } catch (error: unknown) {
      this.depth -= 1
      this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      this.db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      if (this.depth === 0) this.pending = []
      throw error
    }
  }

  /** Register a callback to run after the outermost transaction commits. */
  afterCommit(fn: () => void): void {
    if (this.depth === 0) fn()
    else this.pending.push(fn)
  }

  /** The write-side repository port consumed by the domain Engine. */
  readonly repo: Repositories = {
    atomic: <T>(fn: () => T): T => this.atomic(fn),
    afterCommit: (fn: () => void): void => { this.afterCommit(fn) },
    triggers: {
      get: (id) => {
        const row = this.db.prepare('SELECT value FROM trigger WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Trigger
      },
      save: (trigger) => {
        this.db.prepare('INSERT INTO trigger(id, value, at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, at=excluded.at')
          .run(trigger.id, JSON.stringify(trigger), trigger.at)
        this.db.prepare('INSERT OR IGNORE INTO trigger_thread(thread, id, at, human) VALUES(?, ?, ?, ?)')
          .run(`${trigger.threads[0]?.source ?? ''}:${trigger.threads[0]?.id ?? ''}`, trigger.id, trigger.at, trigger.human ? 1 : 0)
      },
      disposition: (id) => {
        const row = this.db.prepare('SELECT value FROM disposition WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as TriggerDisposition
      },
      saveDisposition: (id, value) => {
        this.db.prepare('INSERT INTO disposition(id, value) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
          .run(id, JSON.stringify(value))
      },
    },
    threads: {
      get: (key) => {
        const row = this.db.prepare('SELECT value FROM thread WHERE key = ?').get(key) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Thread
      },
      save: (thread) => {
        this.db.prepare('INSERT INTO thread(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run(thread.key, JSON.stringify(thread))
      },
      list: () => (this.db.prepare('SELECT value FROM thread ORDER BY key').all() as Array<{ value: string }>).map(row => readValue(row.value) as Thread),
      active: () => (this.db.prepare('SELECT value FROM thread WHERE active = 1').all() as Array<{ value: string }>).map(row => readValue(row.value) as Thread),
    },
    tickets: {
      get: (id) => {
        const row = this.db.prepare('SELECT value FROM ticket WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Ticket
      },
      save: (ticket) => {
        this.db.prepare('INSERT INTO ticket(id, value) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
          .run(ticket.id, JSON.stringify(ticket))
      },
      list: () => (this.db.prepare('SELECT value FROM ticket ORDER BY rowid').all() as Array<{ value: string }>).map(row => readValue(row.value) as Ticket),
      open: () => (this.db.prepare('SELECT value FROM ticket WHERE open = 1').all() as Array<{ value: string }>).map(row => readValue(row.value) as Ticket),
      active: () => (this.db.prepare('SELECT value FROM ticket WHERE active = 1').all() as Array<{ value: string }>).map(row => readValue(row.value) as Ticket),
    },
    decisions: {
      get: (id) => {
        const row = this.db.prepare('SELECT value FROM decision WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Decision
      },
      save: (decision) => {
        this.db.prepare('INSERT INTO decision(id, thread, value) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
          .run(decision.id, decision.threadKey, JSON.stringify(decision))
      },
      byThread: key => (this.db.prepare('SELECT value FROM decision WHERE thread = ?').all(key) as Array<{ value: string }>).map(row => readValue(row.value) as Decision),
    },
  }

  /** Coalescing enqueue: an existing row keeps its queue position and resets its attempts. */
  enqueueEffect(kind: string, key: string, value: unknown, due: string): void {
    const seq = ++this.seq
    this.db.prepare(`INSERT INTO effect(kind, key, value, seq, generation, attempts, error, due, since)
      VALUES(?, ?, ?, ?, 0, 0, '', ?, ?)
      ON CONFLICT(kind, key) DO UPDATE SET
        value=excluded.value, generation=effect.generation+1, attempts=0, error='', due=excluded.due, since=excluded.since`)
      .run(kind, key, JSON.stringify(value), seq, due, due)
  }

  /** Oldest due rows of one effect kind, in queue order. */
  dueEffects(kind: string, limit: number, now: string): readonly EffectRow[] {
    return this.db.prepare('SELECT * FROM effect WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?')
      .all(kind, now, limit) as unknown as EffectRow[]
  }

  /** Remove a completed effect. */
  deleteEffect(kind: string, key: string, seq: number, generation: number): boolean {
    const result = this.db.prepare('DELETE FROM effect WHERE kind = ? AND key = ? AND seq = ? AND generation = ?')
      .run(kind, key, seq, generation)
    return Number(result.changes) > 0
  }

  /** Record a failed attempt with exponential backoff chosen by the caller. */
  failEffect(kind: string, key: string, seq: number, generation: number, error: string, due: string): void {
    this.db.prepare(`UPDATE effect SET attempts=attempts+1, error=?, due=?
      WHERE kind=? AND key=? AND seq=? AND generation=?`)
      .run(error, due, kind, key, seq, generation)
  }

  /** Add an outbox receipt exactly once. */
  addReceipt(receipt: Receipt): void {
    this.db.prepare('INSERT OR IGNORE INTO outbox(id, value) VALUES(?, ?)').run(receipt.id, JSON.stringify(receipt))
  }

  /** Settle an outbox receipt. */
  settleReceipt(id: string, status: 'sent' | 'dropped', reason?: string): void {
    const row = this.db.prepare('SELECT value FROM outbox WHERE id = ?').get(id) as { value: string } | undefined
    if (row === undefined) return
    const current = readValue(row.value) as Receipt
    const next: Receipt = reason === undefined
      ? { ...current, status }
      : { ...current, status, dropped: { at: new Date().toISOString(), reason } }
    this.db.prepare('UPDATE outbox SET value = ? WHERE id = ?').run(JSON.stringify(next), id)
  }

  /** Pending receipts, oldest first. */
  pendingReceipts(): readonly Receipt[] {
    return (this.db.prepare('SELECT value FROM outbox WHERE pending = 1 ORDER BY rowid').all() as Array<{ value: string }>)
      .map(row => readValue(row.value) as Receipt)
  }

  /** Read a scalar setting. */
  getSetting(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row === undefined ? undefined : readValue(row.value)
  }

  /** Write a scalar setting. */
  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value))
  }

  /** Idempotent close; outstanding transactions are committed before closing. */
  close(): void {
    if (this.closing) return
    this.closing = true
    this.db.close()
  }
}

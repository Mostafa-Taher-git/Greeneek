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
  private db: DatabaseSync | undefined
  private readonly path: string
  private depth = 0
  private pending: Array<() => void> = []
  private closing = false
  private seq = 0

  /** @param path - absolute database path; the parent directory is created owner-only. */
  constructor(path: string) {
    this.path = path
  }

  /** Open the database on first use so startup does not load node:sqlite. */
  private connection(): DatabaseSync {
    if (this.db === undefined) {
      this.db = openDatabase(this.path)
      const last = this.connection().prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM effect').get() as { seq: number }
      this.seq = last.seq
    }
    return this.db
  }

  /**
   * Begin or nest a transaction.
   * @param fn - work to run inside the savepoint.
   * @returns the value produced by the work.
   */
  atomic<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}_${this.seq++}`
    this.connection().exec(`SAVEPOINT ${savepoint}`)
    this.depth += 1
    try {
      const result = fn()
      this.depth -= 1
      this.connection().exec(`RELEASE SAVEPOINT ${savepoint}`)
      if (this.depth === 0) {
        const callbacks = this.pending
        this.pending = []
        for (const callback of callbacks) callback()
      }
      return result
    } catch (error: unknown) {
      this.depth -= 1
      this.connection().exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      this.connection().exec(`RELEASE SAVEPOINT ${savepoint}`)
      if (this.depth === 0) this.pending = []
      throw error
    }
  }

  /**
   * Register a callback to run after the outermost transaction commits.
   * @param fn - callback to defer, or run immediately when no transaction is open.
   */
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
        const row = this.connection().prepare('SELECT value FROM trigger WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Trigger
      },
      save: (trigger) => {
        this.connection().prepare('INSERT INTO trigger(id, value, at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, at=excluded.at')
          .run(trigger.id, JSON.stringify(trigger), trigger.at)
        this.connection().prepare('INSERT OR IGNORE INTO trigger_thread(thread, id, at, human) VALUES(?, ?, ?, ?)')
          .run(`${trigger.threads[0]?.source ?? ''}:${trigger.threads[0]?.id ?? ''}`, trigger.id, trigger.at, trigger.human ? 1 : 0)
      },
      disposition: (id) => {
        const row = this.connection().prepare('SELECT value FROM disposition WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as TriggerDisposition
      },
      saveDisposition: (id, value) => {
        this.connection().prepare('INSERT INTO disposition(id, value) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
          .run(id, JSON.stringify(value))
      },
    },
    threads: {
      get: (key) => {
        const row = this.connection().prepare('SELECT value FROM thread WHERE key = ?').get(key) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Thread
      },
      save: (thread) => {
        this.connection().prepare('INSERT INTO thread(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run(thread.key, JSON.stringify(thread))
      },
      list: () => (this.connection().prepare('SELECT value FROM thread ORDER BY key').all() as Array<{ value: string }>).map(row => readValue(row.value) as Thread),
      active: () => (this.connection().prepare('SELECT value FROM thread WHERE active = 1').all() as Array<{ value: string }>).map(row => readValue(row.value) as Thread),
    },
    tickets: {
      get: (id) => {
        const row = this.connection().prepare('SELECT value FROM ticket WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Ticket
      },
      save: (ticket) => {
        this.connection().prepare('INSERT INTO ticket(id, value) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
          .run(ticket.id, JSON.stringify(ticket))
      },
      list: () => (this.connection().prepare('SELECT value FROM ticket ORDER BY rowid').all() as Array<{ value: string }>).map(row => readValue(row.value) as Ticket),
      open: () => (this.connection().prepare('SELECT value FROM ticket WHERE open = 1').all() as Array<{ value: string }>).map(row => readValue(row.value) as Ticket),
      active: () => (this.connection().prepare('SELECT value FROM ticket WHERE active = 1').all() as Array<{ value: string }>).map(row => readValue(row.value) as Ticket),
    },
    decisions: {
      get: (id) => {
        const row = this.connection().prepare('SELECT value FROM decision WHERE id = ?').get(id) as { value: string } | undefined
        return row === undefined ? undefined : readValue(row.value) as Decision
      },
      save: (decision) => {
        this.connection().prepare('INSERT INTO decision(id, thread, value) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
          .run(decision.id, decision.threadKey, JSON.stringify(decision))
      },
      byThread: key => (this.connection().prepare('SELECT value FROM decision WHERE thread = ?').all(key) as Array<{ value: string }>).map(row => readValue(row.value) as Decision),
    },
  }

  /**
   * Coalescing enqueue: an existing row keeps its queue position and resets its attempts.
   * @param kind - effect kind for the coalescing key.
   * @param key - coalescing key within the kind.
   * @param value - JSON-serializable payload.
   * @param due - ISO time when the effect becomes due.
   */
  enqueueEffect(kind: string, key: string, value: unknown, due: string): void {
    const seq = ++this.seq
    this.connection().prepare(`INSERT INTO effect(kind, key, value, seq, generation, attempts, error, due, since)
      VALUES(?, ?, ?, ?, 0, 0, '', ?, ?)
      ON CONFLICT(kind, key) DO UPDATE SET
        value=excluded.value, generation=effect.generation+1, attempts=0, error='', due=excluded.due, since=excluded.since`)
      .run(kind, key, JSON.stringify(value), seq, due, due)
  }

  /**
   * Oldest due rows of one effect kind, in queue order.
   * @param kind - effect kind to read.
   * @param limit - maximum rows to return.
   * @param now - ISO cutoff for considering rows due.
   * @returns the oldest due rows, in sequence order.
   */
  dueEffects(kind: string, limit: number, now: string): readonly EffectRow[] {
    return this.connection().prepare('SELECT * FROM effect WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?')
      .all(kind, now, limit) as unknown as EffectRow[]
  }

  /**
   * Remove a completed effect.
   * @param kind - effect kind to delete.
   * @param key - coalescing key within the kind.
   * @param seq - queue sequence guarding the row.
   * @param generation - generation guarding against a stale handler.
   * @returns true when a row was deleted.
   */
  deleteEffect(kind: string, key: string, seq: number, generation: number): boolean {
    const result = this.connection().prepare('DELETE FROM effect WHERE kind = ? AND key = ? AND seq = ? AND generation = ?')
      .run(kind, key, seq, generation)
    return Number(result.changes) > 0
  }

  /**
   * Defer an effect without consuming a failure attempt.
   * @param kind - effect kind to defer.
   * @param key - coalescing key within the kind.
   * @param seq - queue sequence guarding the row.
   * @param generation - generation guarding against a stale handler.
   * @param error - deferral message recorded on the row.
   * @param due - new ISO time when the effect becomes due.
   */
  deferEffect(kind: string, key: string, seq: number, generation: number, error: string, due: string): void {
    this.connection().prepare(`UPDATE effect SET error=?, due=?
      WHERE kind=? AND key=? AND seq=? AND generation=?`)
      .run(error, due, kind, key, seq, generation)
  }

  /**
   * Record a failed attempt with exponential backoff chosen by the caller.
   * @param kind - effect kind that failed.
   * @param key - coalescing key within the kind.
   * @param seq - queue sequence guarding the row.
   * @param generation - generation guarding against a stale handler.
   * @param error - failure message recorded on the row.
   * @param due - new ISO time when a retry becomes due.
   */
  failEffect(kind: string, key: string, seq: number, generation: number, error: string, due: string): void {
    this.connection().prepare(`UPDATE effect SET attempts=attempts+1, error=?, due=?
      WHERE kind=? AND key=? AND seq=? AND generation=?`)
      .run(error, due, kind, key, seq, generation)
  }

  /**
   * Add an outbox receipt exactly once.
   * @param receipt - durable receipt to insert when its id is new.
   */
  addReceipt(receipt: Receipt): void {
    this.connection().prepare('INSERT OR IGNORE INTO outbox(id, value) VALUES(?, ?)').run(receipt.id, JSON.stringify(receipt))
  }

  /**
   * Settle an outbox receipt.
   * @param id - receipt identifier to settle.
   * @param status - final delivery status.
   * @param reason - optional drop reason recorded on the receipt.
   */
  settleReceipt(id: string, status: 'sent' | 'dropped', reason?: string): void {
    const row = this.connection().prepare('SELECT value FROM outbox WHERE id = ?').get(id) as { value: string } | undefined
    if (row === undefined) return
    const current = readValue(row.value) as Receipt
    const next: Receipt = reason === undefined
      ? { ...current, status }
      : { ...current, status, dropped: { at: new Date().toISOString(), reason } }
    this.connection().prepare('UPDATE outbox SET value = ? WHERE id = ?').run(JSON.stringify(next), id)
  }

  /**
   * Pending receipts, oldest first.
   * @returns receipts that have not been settled yet.
   */
  pendingReceipts(): readonly Receipt[] {
    return (this.connection().prepare('SELECT value FROM outbox WHERE pending = 1 ORDER BY rowid').all() as Array<{ value: string }>)
      .map(row => readValue(row.value) as Receipt)
  }

  /**
   * Total number of stored Triggers.
   * @returns the row count of the trigger table.
   */
  triggerCount(): number {
    const row = this.connection().prepare('SELECT COUNT(*) AS count FROM trigger').get() as { count: number }
    return row.count
  }

  /**
   * Total number of recorded Decisions.
   * @returns the row count of the decision table.
   */
  decisionCount(): number {
    const row = this.connection().prepare('SELECT COUNT(*) AS count FROM decision').get() as { count: number }
    return row.count
  }

  /**
   * Every stored row of one JSON table, for snapshot export.
   * @param table - JSON table to read.
   * @returns raw JSON strings in insertion order.
   */
  snapshotRows(table: 'trigger' | 'disposition' | 'thread' | 'ticket' | 'decision' | 'outbox' | 'kv'): readonly string[] {
    return (this.connection().prepare(`SELECT value FROM ${table} ORDER BY rowid`).all() as Array<{ value: string }>)
      .map(row => row.value)
  }

  /**
   * Write one raw JSON row during snapshot restore.
   * @param table - JSON table to write into.
   * @param _key - unused; the row id is derived from the parsed JSON value.
   * @param value - raw JSON row to insert or replace.
   */
  restoreRow(table: 'trigger' | 'disposition' | 'thread' | 'ticket' | 'decision' | 'outbox' | 'kv', _key: string, value: string): void {
    const columns: Record<string, string> = {
      trigger: 'id, value, at', disposition: 'id, value', thread: 'key, value',
      ticket: 'id, value', decision: 'id, value, thread', outbox: 'id, value', kv: 'key, value',
    }
    const parsed = JSON.parse(value) as Record<string, unknown>
    const text = (candidate: unknown): string => typeof candidate === 'string' ? candidate : ''
    const idColumn = table === 'thread' || table === 'kv' ? 'key' : 'id'
    const id = text(parsed[idColumn])
    const extra = table === 'trigger'
      ? [text(parsed.at) || new Date().toISOString()]
      : table === 'decision' ? [text(parsed.threadKey)] : []
    const placeholders = ['?', '?', ...extra.map(() => '?')].join(', ')
    this.connection().prepare(`INSERT INTO ${table}(${columns[table]}) VALUES(${placeholders}) ON CONFLICT(${idColumn}) DO UPDATE SET value=excluded.value`)
      .run(id, value, ...extra)
  }

  /**
   * Read a scalar setting.
   * @param key - key of the setting to read.
   * @returns the parsed value, or undefined when absent.
   */
  getSetting(key: string): unknown {
    const row = this.connection().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row === undefined ? undefined : readValue(row.value)
  }

  /**
   * Write a scalar setting.
   * @param key - key to store the value under.
   * @param value - JSON-serializable value to persist.
   */
  setSetting(key: string, value: unknown): void {
    this.connection().prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value))
  }

  /** Idempotent close; outstanding transactions are committed before closing. */
  close(): void {
    if (this.closing) return
    this.closing = true
    this.db?.close()
    this.db = undefined
  }
}

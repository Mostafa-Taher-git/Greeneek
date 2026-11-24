/**
 * Recorded-session snapshots: a durable, JSON-safe copy of all Deep-agent
 * domain state. Export is read-only; restore writes through the authoritative
 * store in one transaction so a failed import leaves the previous state intact.
 */
import type { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import { DEEP_AGENT_SCHEMA_VERSION } from '@greeneek/gnk-deep-agent-store'

/** One recorded Deep-agent session state. */
export interface DeepAgentSnapshot {
  readonly schemaVersion: number
  readonly createdAt: string
  readonly triggers: readonly unknown[]
  readonly dispositions: readonly unknown[]
  readonly threads: readonly unknown[]
  readonly tickets: readonly unknown[]
  readonly decisions: readonly unknown[]
  readonly outbox: readonly unknown[]
  readonly kv: readonly unknown[]
}

const field = (row: unknown, name: string): string => {
  if (typeof row !== 'object' || row === null) return ''
  const value = (row as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : ''
}

/**
 * Export every durable row in a deterministic order.
 * @param store - authoritative store to read rows from.
 * @returns a JSON-safe snapshot with the current schema version.
 */
export function exportSnapshot(store: DeepAgentStore): DeepAgentSnapshot {
  return {
    schemaVersion: DEEP_AGENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    triggers: store.snapshotRows('trigger').map(value => JSON.parse(value) as unknown),
    dispositions: store.snapshotRows('disposition').map(value => JSON.parse(value) as unknown),
    threads: store.snapshotRows('thread').map(value => JSON.parse(value) as unknown),
    tickets: store.snapshotRows('ticket').map(value => JSON.parse(value) as unknown),
    decisions: store.snapshotRows('decision').map(value => JSON.parse(value) as unknown),
    outbox: store.snapshotRows('outbox').map(value => JSON.parse(value) as unknown),
    kv: store.snapshotRows('kv').map(value => JSON.parse(value) as unknown),
  }
}

/**
 * Restore a recorded snapshot atomically; a foreign or newer schema is refused.
 * @param store - authoritative store to write rows into.
 * @param snapshot - recorded state to restore.
 */
export function restoreSnapshot(store: DeepAgentStore, snapshot: DeepAgentSnapshot): void {
  if (snapshot.schemaVersion !== DEEP_AGENT_SCHEMA_VERSION) {
    throw new Error(`snapshot schema ${snapshot.schemaVersion} is not supported`)
  }
  store.atomic(() => {
    for (const row of snapshot.triggers) {
      store.restoreRow('trigger', field(row, 'id'), JSON.stringify({
        ...(typeof row === 'object' && row !== null ? row : {}), at: field(row, 'at') || new Date().toISOString(),
      }))
    }
    for (const row of snapshot.dispositions) store.restoreRow('disposition', field(row, 'id'), JSON.stringify(row))
    for (const row of snapshot.threads) store.restoreRow('thread', field(row, 'key'), JSON.stringify(row))
    for (const row of snapshot.tickets) store.restoreRow('ticket', field(row, 'id'), JSON.stringify(row))
    for (const row of snapshot.decisions) store.restoreRow('decision', field(row, 'id'), JSON.stringify(row))
    for (const row of snapshot.outbox) store.restoreRow('outbox', field(row, 'id'), JSON.stringify(row))
    for (const row of snapshot.kv) store.restoreRow('kv', field(row, 'key'), JSON.stringify(row))
  })
}

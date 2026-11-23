/**
 * Deep-agent SQLite schema. Each version is a deliberate, monotonic step;
 * a stored version outside the accepted set fails loud. A fresh file is
 * stamped last so a partial initialization leaves it unstamped.
 */
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Current schema version; increment for a breaking table layout. */
export const DEEP_AGENT_SCHEMA_VERSION = 1
/** Lowest accepted stored version. */
export const DEEP_AGENT_OLDEST_SCHEMA = 1
/** Application id distinguishing this database from other SQLite files. */
export const DEEP_AGENT_APPLICATION_ID = 0x4441474e

/** Owner-only file creation; an existing file is left untouched. */
export function createDatabaseFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try {
    closeSync(openSync(path, 'wx', 0o600))
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
  }
  chmodSync(path, 0o600)
}

const TABLES = `
CREATE TABLE IF NOT EXISTS trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS disposition (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread (
  key TEXT PRIMARY KEY, value TEXT NOT NULL,
  active INTEGER GENERATED ALWAYS AS (json_extract(value, '$.pending') IS NOT NULL AND json_array_length(json_extract(value, '$.pending')) > 0) VIRTUAL,
  subscribed INTEGER GENERATED ALWAYS AS (json_extract(value, '$.subscriptions') IS NOT NULL AND json_array_length(json_extract(value, '$.subscriptions')) > 0) VIRTUAL
);
CREATE TABLE IF NOT EXISTS ticket (
  id TEXT PRIMARY KEY, value TEXT NOT NULL,
  open INTEGER GENERATED ALWAYS AS (json_extract(value, '$.ended') IS NULL) VIRTUAL,
  active INTEGER GENERATED ALWAYS AS (json_extract(value, '$.ended') IS NULL OR json_array_length(json_extract(value, '$.undelivered')) > 0) VIRTUAL
);
CREATE TABLE IF NOT EXISTS decision (id TEXT PRIMARY KEY, thread TEXT NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS effect (
  kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, seq INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '', due TEXT NOT NULL, since TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, value TEXT NOT NULL,
  dropped INTEGER GENERATED ALWAYS AS (json_extract(value, '$.status') = 'dropped') VIRTUAL,
  pending INTEGER GENERATED ALWAYS AS (json_extract(value, '$.status') = 'pending') VIRTUAL
);
CREATE TABLE IF NOT EXISTS trigger_thread (
  thread TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, human INTEGER NOT NULL,
  PRIMARY KEY (thread, id)
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

const INDEXES = `
CREATE INDEX IF NOT EXISTS trigger_at ON trigger(at);
CREATE INDEX IF NOT EXISTS trigger_thread_at ON trigger_thread(thread, at);
CREATE INDEX IF NOT EXISTS decision_thread ON decision(thread);
CREATE INDEX IF NOT EXISTS effect_due ON effect(kind, due, seq);
CREATE INDEX IF NOT EXISTS thread_active ON thread(active) WHERE active IS NOT NULL;
CREATE INDEX IF NOT EXISTS thread_subscribed ON thread(subscribed) WHERE subscribed IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_open ON ticket(open) WHERE open IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_active ON ticket(active) WHERE active IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_dropped ON outbox(dropped) WHERE dropped IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(pending) WHERE pending IS NOT NULL;
`

/** Open and initialize a Deep-agent database, refusing foreign or incompatible files. */
export function openDatabase(path: string): DatabaseSync {
  createDatabaseFile(path)
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    const applicationId = Number(db.prepare('PRAGMA application_id').get()?.application_id ?? 0)
    if (applicationId !== 0 && applicationId !== DEEP_AGENT_APPLICATION_ID) {
      throw new Error('deep-agent store: the file is a different SQLite database')
    }
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version !== 0 && (version < DEEP_AGENT_OLDEST_SCHEMA || version > DEEP_AGENT_SCHEMA_VERSION)) {
      throw new Error(`deep-agent store: unsupported schema version ${version}`)
    }
    db.exec(TABLES)
    db.exec(INDEXES)
    if (version === 0) {
      db.exec(`PRAGMA application_id = ${DEEP_AGENT_APPLICATION_ID};`)
      db.exec(`PRAGMA user_version = ${DEEP_AGENT_SCHEMA_VERSION};`)
    }
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

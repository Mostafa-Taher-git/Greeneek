import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeepAgentStore } from '../src/index.ts'
import {
  DEEP_AGENT_APPLICATION_ID, DEEP_AGENT_SCHEMA_VERSION, openDatabase,
} from '../src/schema.ts'
import type { Ticket } from '@greeneek/gnk-deep-agent-core'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-store-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const ticket = (id: string): Ticket => ({
  id,
  title: 'Fix the build',
  decisionId: 'd1',
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'chat', id: 'alice' }, scope: 'chat:t1' },
  channels: [],
  assignments: [],
  inputs: [],
  undelivered: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  origin: { triggerId: 't1', triggerIds: ['t1'] },
})

describe('schema', () => {
  it('stamps application id and version on a fresh database', () => {
    const path = join(tempDir(), 'deep-agent.sqlite')
    const db = openDatabase(path)
    expect(Number(db.prepare('PRAGMA application_id').get()?.application_id)).toBe(DEEP_AGENT_APPLICATION_ID)
    expect(Number(db.prepare('PRAGMA user_version').get()?.user_version)).toBe(DEEP_AGENT_SCHEMA_VERSION)
    db.close()
  })

  it('refuses a foreign database file', () => {
    const path = join(tempDir(), 'foreign.sqlite')
    const foreign = openDatabase(path)
    foreign.exec('PRAGMA application_id = 42;')
    foreign.close()
    expect(() => openDatabase(path)).toThrow(/different SQLite database/)
  })

  it('refuses a newer schema version', () => {
    const path = join(tempDir(), 'future.sqlite')
    const db = openDatabase(path)
    db.exec(`PRAGMA user_version = ${DEEP_AGENT_SCHEMA_VERSION + 1};`)
    db.close()
    expect(() => openDatabase(path)).toThrow(/unsupported schema version/)
  })
})

describe('repositories', () => {
  it('persists tickets across reopen', () => {
    const path = join(tempDir(), 'deep-agent.sqlite')
    const first = new DeepAgentStore(path)
    first.repo.tickets.save(ticket('ticket-1'))
    first.close()
    const second = new DeepAgentStore(path)
    expect(second.repo.tickets.get('ticket-1')?.title).toBe('Fix the build')
    expect(second.repo.tickets.open().map(item => item.id)).toEqual(['ticket-1'])
    second.close()
  })

  it('rolls back a failed nested transaction', () => {
    const store = new DeepAgentStore(join(tempDir(), 'deep-agent.sqlite'))
    store.atomic(() => {
      store.repo.tickets.save(ticket('kept'))
      expect(() => store.atomic(() => {
        store.repo.tickets.save(ticket('dropped'))
        throw new Error('fail')
      })).toThrow('fail')
    })
    expect(store.repo.tickets.get('kept')).toBeDefined()
    expect(store.repo.tickets.get('dropped')).toBeUndefined()
    store.close()
  })

  it('runs afterCommit callbacks once at the outermost commit', () => {
    const store = new DeepAgentStore(join(tempDir(), 'deep-agent.sqlite'))
    const seen: string[] = []
    store.atomic(() => {
      store.afterCommit(() => { seen.push('outer') })
      store.atomic(() => { store.afterCommit(() => { seen.push('inner') }) })
      expect(seen).toEqual([])
    })
    expect(seen).toEqual(['outer', 'inner'])
    store.close()
  })
})

describe('effects and outbox', () => {
  it('coalesces an effect without losing its queue position', () => {
    const store = new DeepAgentStore(join(tempDir(), 'deep-agent.sqlite'))
    store.enqueueEffect('reply', 'r1', { text: 'one' }, '2026-01-01T00:00:00.000Z')
    store.enqueueEffect('notice', 'n1', { text: 'two' }, '2026-01-01T00:00:01.000Z')
    store.enqueueEffect('reply', 'r1', { text: 'updated' }, '2026-01-01T00:00:02.000Z')
    const due = store.dueEffects('reply', 10, '2026-01-02T00:00:00.000Z')
    expect(due).toHaveLength(1)
    const first = due[0]
    expect(first).toBeDefined()
    expect((JSON.parse(first?.value ?? '{}') as { text: string }).text).toBe('updated')
    expect(first?.generation).toBe(1)
    expect(first?.attempts).toBe(0)
    store.close()
  })

  it('adds an outbox receipt exactly once and settles it', () => {
    const store = new DeepAgentStore(join(tempDir(), 'deep-agent.sqlite'))
    const receipt = { id: 'msg-1', value: '{}', status: 'pending' as const }
    store.addReceipt(receipt)
    store.addReceipt(receipt)
    expect(store.pendingReceipts()).toHaveLength(1)
    store.settleReceipt('msg-1', 'sent')
    expect(store.pendingReceipts()).toHaveLength(0)
    store.close()
  })
})

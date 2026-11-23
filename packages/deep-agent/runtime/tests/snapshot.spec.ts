import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import { exportSnapshot, restoreSnapshot } from '../src/snapshot.ts'
import type { Ticket } from '@greeneek/gnk-deep-agent-core'

const dirs: string[] = []
const stores: DeepAgentStore[] = []
function open(): DeepAgentStore {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-snapshot-'))
  dirs.push(dir)
  const store = new DeepAgentStore(join(dir, 'deep-agent.sqlite'))
  stores.push(store)
  return store
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const ticket = (id: string): Ticket => ({
  id, title: 'Snapshot ticket', decisionId: 'd1',
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'github', id: 'alice' }, scope: 'github:7' },
  channels: [], assignments: [{ id: 'a1', state: 'running', createdAt: '2026-01-01T00:00:00.000Z' }],
  inputs: [], undelivered: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  origin: { triggerId: 't1', triggerIds: ['t1'] },
})

describe('recorded snapshots', () => {
  it('exports triggers, threads, tickets, decisions and settings rows', () => {
    const store = open()
    store.repo.triggers.save({
      id: 't1', source: 'github', threads: [{ source: 'github', id: '7' }],
      actor: { source: 'github', id: 'alice' }, human: true, at: '2026-01-01T00:00:00.000Z',
      text: 'fix it', meta: {},
    })
    store.repo.threads.save({
      key: 'github:7', ref: { source: 'github', id: '7' }, createdAt: '2026-01-01T00:00:00.000Z',
      subscriptions: ['ticket-1'], correlated: [], pending: [], meta: {},
    })
    store.repo.tickets.save(ticket('ticket-1'))
    store.setSetting('router.sessionId', 'router-1')
    const snapshot = exportSnapshot(store)
    expect(snapshot.triggers).toHaveLength(1)
    expect(snapshot.threads).toHaveLength(1)
    expect(snapshot.tickets).toHaveLength(1)
    expect(snapshot.kv.some(row => JSON.stringify(row).includes('router-1'))).toBe(true)
  })

  it('restores a snapshot into a fresh store and refuses a foreign schema', () => {
    const source = open()
    source.repo.tickets.save(ticket('ticket-1'))
    const snapshot = exportSnapshot(source)
    const target = open()
    expect(target.repo.tickets.get('ticket-1')).toBeUndefined()
    restoreSnapshot(target, snapshot)
    expect(target.repo.tickets.get('ticket-1')?.title).toBe('Snapshot ticket')
    expect(() => { restoreSnapshot(target, { ...snapshot, schemaVersion: 999 }) }).toThrow(/not supported/)
  })

  it('preserves decisions and assignments across export and restore', () => {
    const source = open()
    source.repo.decisions.save({
      id: 'd1', evalId: 'e1', threadKey: 'github:7', triggerIds: ['t1'],
      policyVersion: 'v1', at: '2026-01-01T00:00:00.000Z', kind: 'accept',
      reason: [], strength: 'explicit', ticketId: 'ticket-1',
    })
    const snapshot = exportSnapshot(source)
    const target = open()
    restoreSnapshot(target, snapshot)
    expect(target.repo.decisions.get('d1')?.ticketId).toBe('ticket-1')
  })
})

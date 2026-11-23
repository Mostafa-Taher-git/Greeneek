import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import { DEFAULT_RETRIES, Effects, Later } from '../src/index.ts'

const dirs: string[] = []
const openStores: DeepAgentStore[] = []
function store(): DeepAgentStore {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-effects-'))
  dirs.push(dir)
  const db = new DeepAgentStore(join(dir, 'deep-agent.sqlite'))
  openStores.push(db)
  return db
}
afterEach(() => {
  for (const db of openStores.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const past = '2020-01-01T00:00:00.000Z'

describe('effects', () => {
  it('delivers a due effect once and removes its row', async () => {
    const db = store()
    const effects = new Effects(db)
    const handler = vi.fn()
    effects.on('reply', handler)
    effects.enqueue('reply', 'r1', {}, past)
    await effects.drain()
    expect(handler).toHaveBeenCalledOnce()
    expect(effects.pending('reply', 'r1')).toBe(false)
    await effects.drain()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('coalesces by kind and key while keeping queue position', () => {
    const db = store()
    const effects = new Effects(db)
    effects.enqueue('reply', 'r1', { id: '1' }, past)
    effects.enqueue('notice', 'n1', { value: '{}', summary: 's' }, past)
    effects.enqueue('reply', 'r1', { id: '2' }, past)
    const rows = db.dueEffects('reply', 10, '9999-01-01T00:00:00.000Z')
    expect(rows).toHaveLength(1)
    expect((JSON.parse(rows[0]?.value ?? '{}') as { id: string }).id).toBe('2')
    expect(rows[0]?.generation).toBe(1)
  })

  it('retries a failure with backoff and drops it after the cap', async () => {
    const db = store()
    const effects = new Effects(db, { ...DEFAULT_RETRIES, reply: { baseMs: 1_000, maxMs: 2_000, tries: 2 } })
    const handler = vi.fn(() => { throw new Error('boom') })
    effects.on('reply', handler)
    effects.enqueue('reply', 'r1', {}, past)
    await effects.drain(past)
    expect(handler).toHaveBeenCalledOnce()
    expect(effects.pending('reply', 'r1')).toBe(true)
    const row = db.dueEffects('reply', 1, '9999-01-01T00:00:00.000Z')[0]
    expect(row?.attempts).toBe(1)
    expect(row?.error).toBe('boom')
    await effects.drain('9999-01-01T00:00:00.000Z')
    expect(effects.pending('reply', 'r1')).toBe(false)
  })

  it('defers on Later without counting a failure', async () => {
    const db = store()
    const effects = new Effects(db)
    effects.on('reply', () => { throw new Later('no slot') })
    effects.enqueue('reply', 'r1', {}, past)
    await effects.drain(past)
    const row = db.dueEffects('reply', 1, '9999-01-01T00:00:00.000Z')[0]
    expect(row?.attempts).toBe(0)
    expect(row?.error).toBe('no slot')
  })

  it('keeps ordered kinds behind their oldest row', async () => {
    const db = store()
    const effects = new Effects(db)
    const seen: string[] = []
    effects.on('relay', (value) => { seen.push((value as { text: string }).text) })
    effects.enqueue('relay', 'r1', { text: 'first' }, past)
    effects.enqueue('relay', 'r2', { text: 'second' }, past)
    await effects.drain()
    expect(seen).toEqual(['first'])
    await effects.drain()
    expect(seen).toEqual(['first', 'second'])
  })

  it('continues pending work after reopening the store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deep-agent-effects-'))
    dirs.push(dir)
    const path = join(dir, 'deep-agent.sqlite')
    const first = new DeepAgentStore(path)
    const queued = new Effects(first)
    queued.enqueue('launch', 'l1', { ticketId: 't1', assignmentId: 'a1' }, past)
    first.close()
    const second = new DeepAgentStore(path)
    const resumed = new Effects(second)
    const handler = vi.fn()
    resumed.on('launch', handler)
    await resumed.drain()
    expect(handler).toHaveBeenCalledOnce()
    expect(second.dueEffects('launch', 10, '9999-01-01T00:00:00.000Z')).toHaveLength(0)
    second.close()
  })
})

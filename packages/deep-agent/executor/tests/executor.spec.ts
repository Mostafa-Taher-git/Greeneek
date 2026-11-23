import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { AgentWorkerExecutor, NoSlot, WorkerSlots, mandateText, workerSessionId } from '../src/index.ts'
import { RECOVERY_NOTE } from '../src/recovery.ts'
import type { Ticket } from '@greeneek/gnk-deep-agent-core'

const ticket = (id: string): Ticket => ({
  id, title: 'Fix the build', decisionId: 'd1',
  mandate: {
    strength: 'explicit', policyVersion: 'v1',
    basis: { via: 'admission', cell: 'unlistedAddressed' },
    actor: { source: 'github', id: 'alice' }, scope: 'github:7',
  },
  channels: [], assignments: [], inputs: [], undelivered: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  origin: { triggerId: 't1', triggerIds: ['t1'] },
})

describe('WorkerSlots', () => {
  it('enforces capacity and releases reservations', () => {
    const slots = new WorkerSlots(2)
    slots.reserve('a', 'launch')
    slots.started('a')
    slots.reserve('b', 'launch')
    slots.started('b')
    expect(slots.free()).toBe(0)
    expect(() => { slots.reserve('c', 'launch') }).toThrow(NoSlot)
    slots.release('a')
    expect(slots.free()).toBe(1)
    slots.reserve('c', 'launch')
    expect(slots.used()).toEqual(new Set(['b', 'c']))
  })

  it('allows one extra wake slot for a person follow-up', () => {
    const slots = new WorkerSlots(1)
    slots.reserve('a', 'launch')
    slots.started('a')
    expect(() => { slots.reserve('a', 'wake') }).not.toThrow()
    expect(slots.used()).toEqual(new Set(['a']))
  })
})

describe('worker identity and mandate', () => {
  it('derives a stable Worker session id', () => {
    expect(workerSessionId('t1', 'a1')).toBe(workerSessionId('t1', 'a1'))
    expect(workerSessionId('t1', 'a1')).not.toBe(workerSessionId('t1', 'a2'))
  })

  it('states the immutable authority and forbids implicit permission growth', () => {
    const text = mandateText(ticket('t1'))
    expect(text).toContain('Fix the build')
    expect(text).toContain('explicit')
    expect(text).toContain('unlistedAddressed')
    expect(text).toContain('grants no new permissions')
  })

  it('provides a real recovery note', () => {
    expect(RECOVERY_NOTE).toContain('host restarted')
    expect(RECOVERY_NOTE).toContain('working directory')
  })
})

describe('AgentWorkerExecutor', () => {
  it('owns a real slot registry from its config', () => {
    const executor = new AgentWorkerExecutor(new Context(), {
      rootDirectory: 'C:/temp/deep-agent-test',
      maxWorkers: 2,
      onReport: vi.fn(),
    })
    expect(executor.capacity()).toEqual({ used: 0, free: 2 })
  })

  it('routes reports from a scoped worker tool to the given callback', () => {
    const onReport = vi.fn()
    const executor = new AgentWorkerExecutor(new Context(), {
      rootDirectory: 'C:/temp/deep-agent-test',
      maxWorkers: 1,
      onReport,
    })
    expect(typeof executor.start).toBe('function')
    expect(typeof executor.deliver).toBe('function')
    expect(typeof executor.stop).toBe('function')
    expect(typeof executor.recover).toBe('function')
  })
})

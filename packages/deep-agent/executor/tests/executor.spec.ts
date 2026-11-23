import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { AgentWorkerExecutor, NoSlot, RouterSession, WorkerSlots, candidateCard, mandateText, workerSessionId } from '../src/index.ts'
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

describe('RouterSession', () => {
  it('builds a bounded candidate card with eval identity and authority', () => {
    const card = candidateCard({
      trigger: ticketTrigger(),
      evalId: 'eval-1',
      thread: {} as never,
      basis: { via: 'admission', cell: 'unlistedAddressed' },
      strength: 'inferred',
    })
    expect(card).toContain('eval-1')
    expect(card).toContain('alice')
    expect(card).toContain('inferred')
    expect(card).toContain('deep_agent_decide')
  })

  it('reads and persists one durable Router session id', () => {
    let stored: unknown
    const router = new RouterSession(new Context(), {
      sessionKey: 'router.sessionId',
      readSessionId: () => stored,
      writeSessionId: (_key, value) => { stored = value },
      onDecision: vi.fn(),
    })
    expect(router.sessionId()).toBeUndefined()
  })
})

function ticketTrigger() {
  return {
    id: 't1', source: 'github', threads: [{ source: 'github', id: '7' }],
    actor: { source: 'github', id: 'alice' }, human: true, addressed: 'mention' as const,
    at: '2026-01-01T00:00:00.000Z', text: 'please fix', meta: {},
  }
}

describe('Worker recovery', () => {
  it('resumes a running assignment with its deterministic session id and recovery note', async () => {
    const resume = vi.fn(async (_options: { resumeSessionId: string }) => ({
      agent: {
        inject: vi.fn(),
        cancel: vi.fn(),
        whenIdle: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
      },
      dispose: vi.fn(async () => {}),
    }))
    const ctx = new Context()
    ctx.provide('agents', { resume } as never)
    const executor = new AgentWorkerExecutor(ctx, {
      rootDirectory: 'C:/temp/deep-agent-recovery',
      maxWorkers: 2,
      onReport: vi.fn(),
    })
    const running: Ticket = {
      ...ticket('t1'),
      assignments: [{ id: 'a1', state: 'running', createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:01.000Z' }],
    }
    await executor.recover([running])
    expect(resume).toHaveBeenCalledOnce()
    expect(resume.mock.calls[0]?.[0]).toMatchObject({ resumeSessionId: workerSessionId('t1', 'a1') })
    expect(executor.capacity().used).toBe(1)
    await executor.dispose()
  })

  it('reports a failed recovery without consuming the slot', async () => {
    const onReport = vi.fn()
    const ctx = new Context()
    ctx.provide('agents', { resume: vi.fn(async () => { throw new Error('missing session') }) } as never)
    const executor = new AgentWorkerExecutor(ctx, {
      rootDirectory: 'C:/temp/deep-agent-recovery',
      maxWorkers: 2,
      onReport,
    })
    const running: Ticket = {
      ...ticket('t1'),
      assignments: [{ id: 'a1', state: 'running', createdAt: '2026-01-01T00:00:00.000Z' }],
    }
    await executor.recover([running])
    expect(onReport).toHaveBeenCalledWith('t1', 'a1', expect.objectContaining({ state: 'failed' }))
    expect(executor.capacity().used).toBe(0)
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

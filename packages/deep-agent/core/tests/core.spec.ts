import { describe, expect, it, vi } from 'vitest'
import { Engine, REQUEUES } from '../src/engine.ts'
import { MemoryRepositories } from '../src/memory.ts'
import { key } from '../src/ids.ts'
import { ticketStage, canRetry } from '../src/stage.ts'
import type { EngineOptions, Candidate, GateResult, Policy } from '../src/ports.ts'
import type { Trigger, Ticket } from '../src/types.ts'

function trigger(id: string, overrides: Partial<Trigger> = {}): Trigger {
  return {
    id,
    source: 'chat',
    threads: [{ source: 'chat', id: 't1' }],
    actor: { source: 'chat', id: 'alice' },
    human: true,
    addressed: 'mention',
    at: '2026-01-01T00:00:00.000Z',
    text: 'Please fix the failing build',
    channel: { source: 'chat', thread: 't1', address: { chat: 'c1' } },
    meta: {},
    ...overrides,
  }
}

/** Test harness with scripted policy, assessor, executor, and outbox. */
function harness() {
  const repo = new MemoryRepositories()
  const requests: Candidate[] = []
  const launches: Array<[Ticket, string]> = []
  const deliveries: Array<[Ticket, string, readonly string[]]> = []
  const stops: Array<[Ticket, string]> = []
  const outbox: Array<{ id: string; kind: string }> = []
  let clock = Date.parse('2026-01-01T00:00:00.000Z')
  let paused = false
  const policy: Policy = {
    version: 'v1',
    get paused() { return paused },
    evalTimeoutMs: 60_000,
    gate: (t): GateResult => t.meta.blocked === true || !t.human
      ? { admissible: false, reason: t.meta.blocked === true ? 'chat not allowed' : 'not_human' }
      : { admissible: true, strength: t.addressed !== undefined ? 'explicit' : 'inferred', basis: { via: 'addressed', addressed: t.addressed ?? 'mention' } },
    revalidate: () => true,
    admitsInferred: rules => rules.length > 0,
  }
  const options: EngineOptions = {
    repo,
    policy: () => policy,
    scopes: {
      chat: {
        scope: t => t.meta.blocked === true ? { listened: false, reason: 'chat not allowed' } : { listened: true },
        allowed: a => a.id === 'alice',
        bots: () => false,
      },
    },
    assessor: { request: (candidate) => { requests.push(candidate) } },
    events: { emit: vi.fn() },
    outbox: {
      send: (message) => {
        if (!outbox.some(item => item.id === message.id)) outbox.push({ id: message.id, kind: message.kind })
      },
    },
    executor: {
      start: (ticket, assignmentId) => { launches.push([ticket, assignmentId]) },
      deliver: (ticket, assignmentId, ids) => { deliveries.push([ticket, assignmentId, ids]) },
      stop: (ticket, reason) => { stops.push([ticket, reason]) },
    },
    now: () => new Date(clock).toISOString(),
  }
  const engine = new Engine(options)
  const pump = (): void => {
    engine.evaluateDue()
    for (const [ticket, assignmentId] of launches.splice(0)) engine.assignmentStarted(ticket.id, assignmentId)
    for (const [ticket, assignmentId, ids] of deliveries.splice(0)) engine.inputsDelivered(ticket.id, assignmentId, ids)
  }
  const accept = (id = '1', thread = 't1'): { decision: ReturnType<Engine['decide']>; ticket: Ticket } => {
    engine.receive(trigger(id, { threads: [{ source: 'chat', id: thread }] }))
    pump()
    const evalId = requests.at(-1)?.evalId
    const decision = engine.decide(id, { accept: true, matchedRules: ['rule'], ...(evalId === undefined ? {} : { evalId }) })
    return { decision, ticket: repo.tickets.get(decision.ticketId!)! }
  }
  return {
    repo, engine, requests, outbox, stops, pump, accept, policy,
    tick: (seconds: number) => { clock += seconds * 1000 },
    setPaused: (value: boolean) => { paused = value },
  }
}

describe('intake', () => {
  it('stores a Trigger once and filters out unlistened scopes', () => {
    const h = harness()
    expect(h.engine.receive(trigger('1'))).toBe('received')
    expect(h.engine.receive(trigger('1'))).toBe('duplicate')
    expect(h.engine.receive(trigger('2', { meta: { blocked: true } }))).toBe('filtered')
    expect(h.repo.triggers.disposition('2')?.filtered).toEqual({ code: 'chat not allowed' })
    expect(h.repo.threads.get('chat:t1')?.pending).toEqual(['1'])
  })

  it('correlates a multi-thread Trigger and evaluates only the primary Thread', () => {
    const h = harness()
    h.engine.receive(trigger('1', { threads: [{ source: 'gh', id: 'pr-7' }, { source: 'gh', id: 'run-9' }] }))
    expect(h.repo.threads.get('gh:pr-7')).toMatchObject({ pending: ['1'], correlated: ['gh:run-9'] })
    expect(h.repo.threads.get('gh:run-9')).toMatchObject({ pending: [], correlated: ['gh:pr-7'] })
  })

  it('fans a Trigger out to subscribed Tickets without a new Eval', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    const before = h.requests.length
    h.engine.receive(trigger('2'))
    expect(h.repo.triggers.disposition('2')?.fanout).toEqual([ticket.id])
    expect(h.requests.length).toBe(before)
    expect(h.repo.tickets.get(ticket.id)?.undelivered.length).toBeGreaterThan(0)
  })
})

describe('eval and decision', () => {
  it('ignores at the gate without asking the assessor when nothing is admissible', () => {
    const h = harness()
    h.engine.receive(trigger('1', { human: false }))
    h.pump()
    expect(h.requests.length).toBe(0)
    expect(h.repo.decisions.byThread('chat:t1')).toEqual([expect.objectContaining({ kind: 'ignore', reason: [{ code: 'noAdmissible' }] })])
  })

  it('creates one Ticket with an immutable Mandate on accept', () => {
    const h = harness()
    const { decision, ticket } = h.accept('1')
    expect(decision.kind).toBe('accept')
    expect(decision.ticketId).toBe(ticket.id)
    expect(ticket.mandate).toMatchObject({ strength: 'explicit', policyVersion: 'v1', actor: { id: 'alice' } })
    expect(ticket.mandate.basis.rules).toEqual(['rule'])
    expect(ticket.assignments).toHaveLength(1)
  })

  it('creates exactly one Ticket per accepted Eval', () => {
    const h = harness()
    const first = h.accept('1')
    const second = h.accept('2', 't3')
    expect(first.ticket.id).not.toBe(second.ticket.id)
    expect(h.repo.tickets.open()).toHaveLength(2)
    expect(h.engine.receive(trigger('1'))).toBe('duplicate')
    expect(h.repo.tickets.open()).toHaveLength(2)
  })

  it('expires an Eval twice before recording unavailable', () => {
    const h = harness()
    h.engine.receive(trigger('1'))
    h.pump()
    h.engine.candidateDelivered(h.requests.at(-1)!.evalId)
    for (let i = 0; i <= REQUEUES; i += 1) {
      h.tick(61)
      h.pump()
      const next = h.repo.threads.get('chat:t1')?.evaluating
      if (next !== undefined) h.engine.candidateDelivered(next.id)
    }
    expect(h.repo.decisions.byThread('chat:t1').some(decision => decision.kind === 'unavailable')).toBe(true)
  })
})

describe('ticket lifecycle', () => {
  it('classifies stages and retry eligibility', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    expect(ticketStage(ticket)).toMatchObject({ stage: 'working', action: 'queued' })
    const running: Ticket = { ...ticket, assignments: [{ ...ticket.assignments[0]!, state: 'running', startedAt: new Date().toISOString() }] }
    expect(ticketStage(running)).toEqual({ stage: 'working' })
    const failed: Ticket = { ...running, assignments: [{ ...running.assignments[0]!, report: { state: 'failed', summary: 'boom', at: '2026-01-01T00:10:00.000Z' } }] }
    expect(ticketStage(failed)).toEqual({ stage: 'person', action: 'failed' })
    expect(canRetry(failed)).toBe(true)
  })

  it('ends a Ticket on a ready report and on a human stop', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    h.engine.assignmentStarted(ticket.id, ticket.assignments[0]!.id)
    const ready = h.engine.report(ticket.id, ticket.assignments[0]!.id, { state: 'ready', summary: 'done' })
    expect(ready.ended).toMatchObject({ by: 'executor', outcome: 'completed' })
    const second = h.accept('2', 't2')
    const stopped = h.engine.stopTicket(second.ticket.id, 'no thanks')
    expect(stopped.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    expect(h.stops).toHaveLength(0)
  })

  it('queues each outbound message id once', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    const request = { purpose: 'result' as const, ticketId: ticket.id, text: 'finished' }
    const first = h.engine.reply(request)
    const second = h.engine.reply(request)
    expect(first.id).toBe(second.id)
    expect(h.outbox.filter(item => item.id === first.id)).toHaveLength(1)
  })
})

describe('worker lifecycle operations', () => {
  it('records a human attention question on a report', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    h.engine.assignmentStarted(ticket.id, ticket.assignments[0]!.id)
    const reported = h.engine.report(ticket.id, ticket.assignments[0]!.id, {
      state: 'waiting', summary: 'need a decision', question: 'Which library should I use?',
      askedBy: 't1',
    })
    expect(reported.attention?.question).toBe('Which library should I use?')
    expect(ticketStage(reported)).toEqual({ stage: 'person', action: 'answer' })
  })

  it('retries a failed assignment under the same mandate', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    h.engine.assignmentStarted(ticket.id, ticket.assignments[0]!.id)
    const failed = h.engine.report(ticket.id, ticket.assignments[0]!.id, { state: 'failed', summary: 'network' })
    expect(canRetry(failed)).toBe(true)
    const retried = h.engine.retryTicket(ticket.id)
    expect(retried.assignments).toHaveLength(2)
    expect(retried.assignments[0]?.endedReason).toBe('retried')
    expect(retried.mandate).toEqual(ticket.mandate)
    expect(retried.attention).toBeUndefined()
  })

  it('cancels a running assignment on stop', () => {
    const h = harness()
    const { ticket } = h.accept('1')
    h.engine.assignmentStarted(ticket.id, ticket.assignments[0]!.id)
    const stopped = h.engine.stopTicket(ticket.id, 'operator stop')
    expect(stopped.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    expect(ticketStage(stopped)).toEqual({ stage: 'ended' })
    expect(h.stops).toHaveLength(1)
  })
})

describe('atomicity', () => {
  it('rolls back a nested transaction without losing the outer work', () => {
    const repo = new MemoryRepositories()
    const initial: Trigger = trigger('1')
    repo.atomic(() => {
      repo.triggers.save(initial)
      expect(() => repo.atomic(() => {
        repo.triggers.save(trigger('2'))
        throw new Error('fail')
      })).toThrow('fail')
    })
    expect(repo.triggers.get('1')).toBeDefined()
    expect(repo.triggers.get('2')).toBeUndefined()
  })

  it('runs afterCommit callbacks only after the outermost commit', () => {
    const repo = new MemoryRepositories()
    const seen: string[] = []
    repo.atomic(() => {
      repo.afterCommit(() => { seen.push('outer') })
      repo.atomic(() => { repo.afterCommit(() => { seen.push('inner') }) })
      expect(seen).toEqual([])
    })
    expect(seen).toEqual(['outer', 'inner'])
  })
})

describe('deterministic ids', () => {
  it('derives stable 32-character ids from content', () => {
    expect(key('ticket', 'eval-1')).toBe(key('ticket', 'eval-1'))
    expect(key('ticket', 'eval-1')).toBe('942ca1798f6999d04a1822c11368fc24')
    expect(key('ticket', 'eval-1')).toMatch(/^[0-9a-f]{32}$/)
    expect(key('ticket', 'eval-1')).not.toBe(key('ticket', 'eval-2'))
  })
})

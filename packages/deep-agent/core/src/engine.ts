/**
 * The Deep-agent domain Engine: one synchronous transactional entry point for
 * mutating Triggers, Threads, Decisions, Tickets, and Assignments. Work is
 * queued through ports and never performed inside a domain transaction.
 */
import { UserError } from './errors.ts'
import { key } from './ids.ts'
import { isoTime, liveTicket, threadKey } from './types.ts'
import type {
  Assignment, ChannelRef, Decision, DecisionKind, Mandate, Thread, ThreadRef, Ticket,
  TicketOutcome, Trigger, TriggerDisposition, WorkerReport,
} from './types.ts'
import type { AssessmentOutcome, EngineOptions, GateResult, ReplyStatus } from './ports.ts'

/** Omit one optional key so an absent value is not written as `undefined`. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value
  return rest
}

/** The primary Thread of a Trigger; an event with no Thread is not admissible. */
function primaryThread(trigger: Pick<Trigger, 'threads'>): ThreadRef {
  const first = trigger.threads[0]
  if (first === undefined) throw new UserError('notAdmissible')
  return first
}

/** Number of times an expired Eval requeues its batch before becoming unavailable. */
export const REQUEUES = 2

export type Outcome = AssessmentOutcome & { readonly evalId?: string }
export type ReceiveResult = 'received' | 'duplicate' | 'filtered'
export type ReplyRequest =
  | { readonly purpose: 'acknowledgement'; readonly ticketId: string; readonly triggerId: string; readonly text: string }
  | { readonly purpose: 'answer' | 'result' | 'attention'; readonly ticketId?: string; readonly triggerId?: string; readonly question?: string; readonly text: string }
export interface Reply { readonly id: string; readonly status: ReplyStatus; readonly reused: boolean }

/** The Engine. Callers receive role-scoped methods rather than mutable domain state. */
export class Engine {
  private readonly repo: EngineOptions['repo']
  private readonly now: () => string

  constructor(private readonly options: EngineOptions) {
    this.repo = options.repo
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** Take in a Trigger exactly once, fan it out, and queue its primary Thread for Eval. */
  receive(trigger: Trigger): ReceiveResult {
    return this.repo.atomic(() => {
      const incoming: Trigger = { ...trigger, at: isoTime(trigger.at) }
      if (incoming.threads.length === 0) throw new UserError('notAdmissible')
      if (this.repo.triggers.get(incoming.id) !== undefined) return 'duplicate'
      const scope = this.options.scopes[incoming.source]
      const scoped = scope?.scope(incoming) ?? { listened: true }
      const at = this.now()
      if (!scoped.listened) {
        this.repo.triggers.save(incoming)
        this.repo.triggers.saveDisposition(incoming.id, {
          filtered: { code: scoped.reason ?? 'filtered' }, fanout: [], at,
        })
        this.options.events.emit('trigger.received', { id: incoming.id, filtered: true })
        return 'filtered'
      }
      this.repo.triggers.save(incoming)
      const fanout: string[] = []
      const context: string[] = []
      for (const ref of incoming.threads) {
        const k = threadKey(ref)
        const existing = this.repo.threads.get(k)
        const thread: Thread = existing ?? {
          key: k, ref, createdAt: at, subscriptions: [], correlated: [], pending: [], meta: {},
        }
        const updated: Thread = {
          ...thread,
          lastAt: incoming.at,
          correlated: [...new Set([...thread.correlated, ...incoming.threads.map(threadKey).filter(other => other !== k)])],
        }
        this.repo.threads.save(updated)
        for (const ticketId of thread.subscriptions) {
          const ticket = this.repo.tickets.get(ticketId)
          if (ticket === undefined) continue
          if (ticket.ended !== undefined) {
            if (ticket.ended.by === 'human' || !incoming.human || incoming.addressed === undefined) continue
          }
          const reached = this.repo.threads.get(k)?.subscriptions.includes(ticketId) === true
          if (!reached) continue
          const contextOnly = thread.context?.includes(ticketId) === true
          ;(contextOnly ? context : fanout).push(ticketId)
          if (contextOnly) continue
          this.repo.tickets.save({
            ...ticket,
            inputs: [...ticket.inputs, {
              id: key('input', ticketId, 'trigger', incoming.id), kind: 'trigger', triggerId: incoming.id,
              at, human: incoming.human, context: contextOnly, readAt: null,
            }],
            undelivered: [...ticket.undelivered, key('input', ticketId, 'trigger', incoming.id)],
            updatedAt: at,
          })
        }
      }
      const disposition: TriggerDisposition = { fanout, ...(context.length ? { context } : {}), at }
      this.repo.triggers.saveDisposition(incoming.id, disposition)
      // Fast path: a worker on the primary Thread decides a person's follow-up, so no Eval runs.
      const owners = this.followupOwners(incoming)
      if (owners.length === 0) {
        const primary = primaryThread(incoming)
        const k = threadKey(primary)
        const thread = this.repo.threads.get(k) ?? (() => { throw new UserError('unknownThread', { key: k }) })()
        this.repo.threads.save({ ...thread, pending: [...thread.pending, incoming.id] })
      }
      this.options.events.emit('trigger.received', { id: incoming.id, fanout })
      return 'received'
    })
  }

  private followupOwners(trigger: Trigger): string[] {
    if (!trigger.human) return []
    const disposition = this.repo.triggers.disposition(trigger.id)
    if (disposition === undefined || disposition.requeued === true) return []
    const returned = new Set(disposition.handbacks?.map(item => item.ticketId) ?? [])
    const reached = disposition.fanout.filter(id => !returned.has(id) && !disposition.context?.includes(id))
    const thread = this.repo.threads.get(threadKey(primaryThread(trigger)))
    if (reached.length === 0 || thread?.evaluating?.triggerIds.includes(trigger.id) === true) return []
    return reached.filter((id) => {
      const ticket = this.repo.tickets.get(id)
      return ticket !== undefined && (liveTicket(ticket) || (ticket.ended?.by !== 'human'
        && ticket.inputs.some(input => input.kind === 'trigger' && input.triggerId === trigger.id && ticket.undelivered.includes(input.id))))
    })
  }

  /** The candidate an Eval holds for one Trigger, as its assessor sees it. */
  candidate(triggerId: string): import('./ports.ts').Candidate | undefined {
    for (const thread of this.repo.threads.list()) {
      const evaluating = thread.evaluating
      if (evaluating === undefined || !evaluating.triggerIds.includes(triggerId)) continue
      const trigger = this.repo.triggers.get(triggerId)
      if (trigger === undefined) return undefined
      return {
        trigger,
        evalId: evaluating.id,
        thread,
        basis: evaluating.basis,
        strength: evaluating.strength,
      }
    }
    return undefined
  }

  /** Start overdue Evals and one new Eval per Thread with pending Triggers. */
  evaluateDue(): void {
    const policy = this.options.policy()
    for (const thread of this.repo.threads.active()) {
      if (thread.evaluating !== undefined) {
        this.repo.atomic(() => { this.eval(thread, policy.paused) })
      }
    }
    if (policy.paused) return
    for (const ticket of this.repo.tickets.active()) {
      if (!liveTicket(ticket) && ticket.undelivered.length > 0) this.repo.atomic(() => { this.wake(ticket.id) })
    }
    for (const thread of this.repo.threads.active()) {
      if (thread.pending.length > 0 && thread.evaluating === undefined) {
        this.repo.atomic(() => { this.startEval(thread.key, policy.version, policy.evalTimeoutMs) })
      }
    }
  }

  /** Expire or pause-shift the current Eval of one Thread. */
  private eval(thread: Thread, paused: boolean): void {
    const evaluating = thread.evaluating
    if (evaluating === undefined) return
    if (paused) {
      if (evaluating.pausedAt === undefined) this.repo.threads.save({ ...thread, evaluating: { ...evaluating, pausedAt: this.now() } })
      return
    }
    if (evaluating.pausedAt !== undefined) {
      const shifted = new Date(Date.parse(evaluating.deadline) + (Date.parse(this.now()) - Date.parse(evaluating.pausedAt))).toISOString()
      this.repo.threads.save({ ...thread, evaluating: { ...omit(evaluating, 'pausedAt'), deadline: shifted } })
      return
    }
    if (evaluating.delivered === undefined || this.now() < evaluating.deadline) return
    const expired = (thread.expired ?? 0) + 1
    if (expired <= REQUEUES) {
      this.repo.threads.save({
        ...omit(thread, 'evaluating'),
        pending: [...new Set([...evaluating.triggerIds, ...thread.pending])],
        expired,
      })
      for (const id of evaluating.triggerIds) this.options.events.emit('trigger.requeued', { id })
      return
    }
    this.repo.threads.save(omit(thread, 'evaluating'))
    this.repo.decisions.save({
      id: key('decision', evaluating.id, 'unavailable'),
      evalId: evaluating.id,
      threadKey: thread.key,
      triggerIds: evaluating.triggerIds,
      policyVersion: evaluating.policyVersion,
      at: this.now(),
      kind: 'unavailable',
      reason: [{ code: 'timeout' }],
      strength: evaluating.strength,
    })
    this.options.events.emit('decision.recorded', { kind: 'unavailable' })
  }

  /** Batch a Thread's pending Triggers into one Eval and ask the assessor about the strongest one. */
  private startEval(threadKey: string, policyVersion: string, timeoutMs: number): void {
    const thread = this.repo.threads.get(threadKey)
    if (thread === undefined || thread.pending.length === 0 || thread.evaluating !== undefined) return
    const policy = this.options.policy()
    type Admissible = { readonly trigger: Trigger; readonly scope: Extract<GateResult, { readonly admissible: true }> }
    const admissible: Admissible[] = []
    for (const id of thread.pending) {
      const trigger = this.repo.triggers.get(id)
      if (trigger === undefined) continue
      const gate = policy.gate(trigger, thread, this.repo.tickets.open())
      if (gate.admissible) admissible.push({ trigger, scope: gate })
      else this.repo.triggers.saveDisposition(id, { fanout: [], filtered: { code: gate.reason, triggerId: id }, at: this.now() })
    }
    if (admissible.length === 0) {
      this.repo.threads.save({ ...omit(thread, 'evaluating'), pending: [] })
      this.repo.decisions.save({
        id: key('decision', threadKey, 'noAdmissible', this.now()),
        evalId: key('eval', threadKey, this.now()),
        threadKey,
        triggerIds: thread.pending,
        policyVersion,
        at: this.now(),
        kind: 'ignore',
        reason: [{ code: 'noAdmissible' }],
        strength: 'inferred',
      })
      return
    }
    const strongest = admissible.reduce((best, current) => {
      if (current.scope.strength === 'explicit' && best.scope.strength !== 'explicit') return current
      if (current.scope.strength === best.scope.strength && current.trigger.at > best.trigger.at) return current
      return best
    })
    const primary = strongest.trigger
    const startedAt = this.now()
    const evaluating = {
      id: key('eval', threadKey, policyVersion, startedAt, ...thread.pending),
      threadKey,
      triggerIds: [...thread.pending],
      primary: primary.id,
      strength: strongest.scope.strength,
      actor: primary.actor,
      basis: strongest.scope.basis,
      policyVersion,
      startedAt,
      deadline: new Date(Date.parse(startedAt) + timeoutMs).toISOString(),
    }
    this.repo.threads.save({ ...thread, pending: [], evaluating })
    for (const id of evaluating.triggerIds) {
      const disposition = this.repo.triggers.disposition(id)
      if (disposition !== undefined) this.repo.triggers.saveDisposition(id, { ...disposition, evalId: evaluating.id })
    }
    this.options.events.emit('eval.started', { id: evaluating.id })
    this.options.assessor.request({
      trigger: primary, evalId: evaluating.id, thread,
      basis: evaluating.basis, strength: evaluating.strength,
    })
  }

  /** Mark an Eval delivered; its deadline starts now. */
  candidateDelivered(evalId: string): void {
    this.repo.atomic(() => {
      for (const thread of this.repo.threads.active()) {
        if (thread.evaluating?.id !== evalId) continue
        const delivered = this.now()
        this.repo.threads.save({
          ...thread,
          evaluating: {
            ...thread.evaluating,
            delivered,
            deadline: new Date(Date.parse(delivered) + this.options.policy().evalTimeoutMs).toISOString(),
          },
        })
        return
      }
      throw new UserError('unknownEval', { id: evalId })
    })
  }

  /** Decide the Eval holding a Trigger, or a direct one-Trigger Eval when none does. */
  decide(triggerId: string, outcome: Outcome): Decision {
    return this.repo.atomic(() => {
      const trigger = this.repo.triggers.get(triggerId)
      if (trigger === undefined) throw new UserError('unknownTrigger', { id: triggerId })
      const threadKeyOfTrigger = threadKey(primaryThread(trigger))
      const thread = this.repo.threads.get(threadKeyOfTrigger)
      if (thread === undefined || thread.evaluating === undefined) throw new UserError('evalFinished')
      const evaluating = thread.evaluating
      if (outcome.evalId !== undefined && outcome.evalId !== evaluating.id) throw new UserError('evalFinished')
      const policy = this.options.policy()
      if (outcome.accept && !policy.admitsInferred(outcome.matchedRules ?? []) && evaluating.strength !== 'explicit') {
        throw new UserError('notExplicit')
      }
      const kind: DecisionKind = outcome.accept ? 'accept' : 'ignore'
      const id = key('decision', evaluating.id, kind, triggerId)
      const decision: Decision = {
        id,
        evalId: evaluating.id,
        threadKey: thread.key,
        triggerIds: evaluating.triggerIds,
        policyVersion: evaluating.policyVersion,
        at: this.now(),
        kind,
        reason: outcome.reason === undefined ? [] : [typeof outcome.reason === 'string' ? { code: outcome.reason } : outcome.reason],
        strength: evaluating.strength,
        ...(outcome.audit === undefined ? {} : { audit: outcome.audit }),
      }
      let withTicket = decision
      if (kind === 'accept') {
        const mandate: Mandate = {
          strength: evaluating.strength,
          policyVersion: evaluating.policyVersion,
          basis: {
            ...evaluating.basis,
            ...(outcome.matchedRules === undefined && evaluating.basis.rules === undefined
              ? {}
              : { rules: outcome.matchedRules ?? evaluating.basis.rules }),
          },
          actor: evaluating.actor,
          scope: threadKeyOfTrigger,
        }
        const ticketId = key('ticket', evaluating.id)
        withTicket = { ...decision, ticketId, mandate }
        this.repo.decisions.save(withTicket)
        this.createTicket(ticketId, trigger, withTicket, mandate, evaluating.triggerIds)
        this.repo.threads.save({ ...omit(thread, 'evaluating'), subscriptions: [...new Set([...thread.subscriptions, ticketId])] })
        for (const tid of evaluating.triggerIds) {
          const disposition = this.repo.triggers.disposition(tid)
          if (disposition !== undefined) this.repo.triggers.saveDisposition(tid, { ...disposition, decisionId: withTicket.id })
        }
        this.options.events.emit('ticket.created', { id: ticketId })
      } else {
        this.repo.decisions.save(withTicket)
        const remaining = evaluating.triggerIds.filter(id => id !== triggerId)
        this.repo.threads.save({
          ...omit(thread, 'evaluating'),
          pending: [...new Set([...remaining, ...thread.pending])],
        })
      }
      this.options.events.emit('decision.recorded', { id: withTicket.id, kind })
      return withTicket
    })
  }

  private createTicket(ticketId: string, trigger: Trigger, decision: Decision, mandate: Mandate, triggerIds: readonly string[]): void {
    const at = this.now()
    const assignmentId = key('assignment', ticketId, 0)
    const channels = trigger.channel === undefined ? [] : [trigger.channel]
    const ticket: Ticket = {
      id: ticketId,
      title: trigger.text.slice(0, 200),
      decisionId: decision.id,
      mandate,
      channels,
      assignments: [{ id: assignmentId, state: 'pending', createdAt: at }],
      inputs: [{
        id: key('input', ticketId, 'trigger', trigger.id), kind: 'trigger', triggerId: trigger.id,
        at, human: trigger.human, readAt: null,
      }],
      undelivered: [key('input', ticketId, 'trigger', trigger.id)],
      follows: [],
      createdAt: at,
      updatedAt: at,
      origin: { triggerId: trigger.id, triggerIds: [...triggerIds] },
    }
    this.repo.tickets.save(ticket)
    this.queueLaunch(ticket, assignmentId)
  }

  private queueLaunch(ticket: Ticket, assignmentId: string): void {
    this.options.executor.start(ticket, assignmentId)
  }

  /** Stop a Ticket; its Mandate is withdrawn and it receives nothing more. */
  stopTicket(ticketId: string, reason?: string): Ticket {
    return this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      if (ticket.ended !== undefined) return ticket
      const assignment = ticket.assignments.at(-1)
      if (assignment !== undefined && assignment.state === 'running') {
        this.options.executor.stop(ticket, assignment.id, reason ?? 'Stopped by a person')
      }
      const ended: Ticket = {
        ...omit(ticket, 'attention'),
        ended: { at: this.now(), by: 'human', outcome: 'stopped', ...(reason === undefined ? {} : { reason }) },
        undelivered: [],
        updatedAt: this.now(),
      }
      this.repo.tickets.save(ended)
      this.options.events.emit('ticket.ended', { id: ticketId, outcome: 'stopped' })
      return ended
    })
  }

  /** Retry a stalled Assignment under the same Mandate. */
  retryTicket(ticketId: string): Ticket {
    return this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      if (ticket.ended !== undefined) throw new UserError('alreadyEnded')
      const current = ticket.assignments.at(-1)
      if (current === undefined || !['failed', 'blocked'].includes(current.report?.state ?? '')) throw new UserError('notRetryable')
      const at = this.now()
      const assignments: Assignment[] = [
        ...ticket.assignments.slice(0, -1),
        { ...current, state: 'ended', endedAt: at, endedReason: 'retried' },
        { id: key('assignment', ticketId, at), state: 'pending', createdAt: at },
      ]
      const untaken = ticket.inputs.filter(input => 'readAt' in input && input.readAt === null && ticket.undelivered.includes(input.id)).map(input => input.id)
      const retried: Ticket = { ...omit(ticket, 'attention'), assignments, undelivered: untaken, updatedAt: at }
      this.repo.tickets.save(retried)
      const latest = assignments.at(-1) ?? (() => { throw new UserError('unknownTicket', { id: ticketId }) })()
      this.queueLaunch(retried, latest.id)
      return retried
    })
  }

  /** The Executor's fact that an Assignment started; queued Inputs go out. */
  assignmentStarted(ticketId: string, assignmentId: string): void {
    this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      const assignment = ticket.assignments.find(item => item.id === assignmentId)
      if (assignment === undefined || ticket.ended !== undefined) return
      this.repo.tickets.save({
        ...ticket,
        assignments: ticket.assignments.map(item => item.id === assignmentId ? { ...item, state: 'running', startedAt: this.now() } : item),
      })
      if (ticket.undelivered.length > 0) this.options.executor.deliver(ticket, assignmentId, ticket.undelivered)
      this.options.events.emit('assignment.started', { ticketId, assignmentId })
    })
  }

  /** The Executor's fact that Inputs reached the running Assignment. */
  inputsDelivered(ticketId: string, assignmentId: string, inputIds: readonly string[]): void {
    this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) return
      const at = this.now()
      const { delivery: _cleared, ...withoutDelivery } = ticket
      this.repo.tickets.save({
        ...withoutDelivery,
        undelivered: ticket.undelivered.filter(id => !inputIds.includes(id)),
        inputs: ticket.inputs.map(input => inputIds.includes(input.id) && 'deliveredAt' in input ? { ...input, deliveredTo: assignmentId, deliveredAt: at } : input),
        updatedAt: at,
      })
    })
  }

  /** The Executor's report. `ready` ends the Ticket; attention asks a person; blocked/failed request retry. */
  report(ticketId: string, assignmentId: string, report: WorkerReport): Ticket {
    return this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      const current = ticket.assignments.at(-1)
      if (current === undefined || current.id !== assignmentId || ticket.ended !== undefined) return ticket
      if (report.question !== undefined && report.question !== null && ['ready', 'failed', 'dropped'].includes(report.state)) {
        throw new UserError('questionWithResult')
      }
      const at = this.now()
      const assignments = ticket.assignments.map(item => item.id === assignmentId ? { ...item, report: { ...report, at } } : item)
      const attentionProps = report.question === undefined || report.question === null
        ? {}
        : { attention: { id: key('attention', ticketId, report.question, at), question: report.question, ...(report.askedBy === undefined ? {} : { triggerId: report.askedBy }) } }
      const { attention: _cleared, ...withoutAttention } = ticket
      let updated: Ticket = { ...withoutAttention, ...attentionProps, assignments, updatedAt: at }
      if (report.state === 'dropped') {
        updated = this.end(updated, 'executor', 'dropped')
      } else if (report.state === 'ready') {
        updated = this.end(updated, 'executor', this.followsDone(updated) ? 'merged' : 'completed')
      }
      this.repo.tickets.save(updated)
      this.options.events.emit('assignment.reported', { ticketId, state: report.state })
      return updated
    })
  }

  /** Whether every Thread this Ticket follows has closed. */
  private followsDone(ticket: Ticket): boolean {
    const follows = ticket.follows ?? []
    if (follows.length === 0) return false
    return follows.every(follow => follow.closed !== undefined)
  }

  private end(ticket: Ticket, by: 'executor' | 'human', outcome: TicketOutcome): Ticket {
    const at = this.now()
    const { attention: _cleared, ...withoutAttention } = ticket
    const ended: Ticket = { ...withoutAttention, ended: { at, by, outcome }, undelivered: [], updatedAt: at }
    this.repo.tickets.save(ended)
    this.options.events.emit('ticket.ended', { id: ticket.id, outcome })
    return ended
  }

  /** End a Ticket when a Source reports its followed Thread closed. */
  threadClosed(thread: ThreadRef, outcome: 'merged' | 'closed', at: string): void {
    this.repo.atomic(() => {
      const k = threadKey(thread)
      for (const ticket of this.repo.tickets.open()) {
        if (!(ticket.follows ?? []).some(follow => follow.threadKey === k)) continue
        const follows = (ticket.follows ?? []).map(follow => follow.threadKey === k
          ? { ...follow, closed: { at: isoTime(at), outcome } }
          : follow)
        let updated: Ticket = { ...ticket, follows, updatedAt: this.now() }
        if (this.followsDone(updated) && updated.assignments.at(-1)?.report?.state === 'ready') {
          updated = this.end(updated, 'executor', outcome)
        } else this.repo.tickets.save(updated)
      }
    })
  }

  /** A Source asks an open Ticket to follow one of its Threads. */
  bindThread(ticketId: string, thread: ThreadRef, own: boolean): Ticket {
    return this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      if (ticket.ended !== undefined) throw new UserError('alreadyEnded')
      const k = threadKey(thread)
      const updated: Ticket = {
        ...ticket,
        follows: [...new Set([...(ticket.follows ?? []).map(f => f.threadKey), k])].map(key => ({
          threadKey: key, own: key === k ? own : ticket.follows?.find(f => f.threadKey === key)?.own ?? false,
        })),
        updatedAt: this.now(),
      }
      this.repo.tickets.save(updated)
      const current = this.repo.threads.get(k)
      if (current !== undefined) this.repo.threads.save({ ...current, subscriptions: [...new Set([...current.subscriptions, ticketId])] })
      return updated
    })
  }

  /** Queue an outbound message with a deterministic id so the same message is never sent twice. */
  reply(request: ReplyRequest): Reply {
    return this.repo.atomic(() => {
      const ticket = request.ticketId === undefined ? undefined : this.repo.tickets.get(request.ticketId)
      if (request.ticketId !== undefined && ticket === undefined) throw new UserError('unknownTicket', { id: request.ticketId })
      const trigger = request.triggerId === undefined ? undefined : this.repo.triggers.get(request.triggerId)
      if (request.triggerId !== undefined && trigger === undefined) throw new UserError('unknownTrigger', { id: request.triggerId })
      const channel: ChannelRef | undefined = trigger?.channel ?? ticket?.channels[0]
      if (channel === undefined) throw new UserError('noChannel')
      if (request.purpose === 'acknowledgement' && trigger === undefined) throw new UserError('noChannel')
      const id = key('reply', request.ticketId ?? '', request.triggerId ?? '', request.purpose, request.text)
      const kind = request.purpose === 'acknowledgement' ? 'acknowledgement' : request.purpose === 'attention' ? 'notice' : 'reply'
      this.options.outbox.send({ id, channel, text: request.text, kind, ...(ticket === undefined ? {} : { ticketId: ticket.id }) })
      return { id, status: 'pending', reused: false }
    })
  }

  /** Requeue a stored Trigger for a fresh Eval. */
  reevaluate(triggerId: string): boolean {
    return this.repo.atomic(() => {
      const trigger = this.repo.triggers.get(triggerId)
      if (trigger === undefined) throw new UserError('unknownTrigger', { id: triggerId })
      const k = threadKey(primaryThread(trigger))
      const thread = this.repo.threads.get(k)
      if (thread?.evaluating !== undefined) return false
      const disposition = this.repo.triggers.disposition(triggerId)
      if (disposition !== undefined) this.repo.triggers.saveDisposition(triggerId, { ...disposition, requeued: true })
      const base = thread ?? {
        key: k, ref: primaryThread(trigger), createdAt: this.now(),
        subscriptions: [], correlated: [], pending: [], meta: {},
      }
      this.repo.threads.save({ ...base, pending: [...new Set([...thread?.pending ?? [], triggerId])] })
      return true
    })
  }

  /** Dismiss an unavailable Decision. */
  dismiss(decisionId: string): Decision {
    return this.repo.atomic(() => {
      const decision = this.repo.decisions.get(decisionId)
      if (decision === undefined) throw new UserError('unknownDecision', { id: decisionId })
      if (decision.kind !== 'unavailable') throw new UserError('notAdmissible')
      const updated: Decision = { ...decision, dismissed: this.now() }
      this.repo.decisions.save(updated)
      return updated
    })
  }

  /** Drop every Subscription to a Thread. */
  unsubscribe(thread: string): boolean {
    return this.repo.atomic(() => {
      let changed = false
      for (const current of this.repo.threads.list()) {
        if (current.key !== thread || current.subscriptions.length === 0) continue
        changed = true
        this.repo.threads.save({ ...current, subscriptions: [] })
      }
      return changed
    })
  }

  /** A worker hands a Trigger back: it goes to Eval once no Ticket still owns it. */
  handback(ticketId: string, triggerId: string, reason: string): void {
    this.repo.atomic(() => {
      const ticket = this.repo.tickets.get(ticketId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      const disposition = this.repo.triggers.disposition(triggerId)
      if (disposition === undefined) throw new UserError('unknownTrigger', { id: triggerId })
      if (disposition.handbacks?.some(item => item.ticketId === ticketId) === true) throw new UserError('handedBack')
      const at = this.now()
      this.repo.triggers.saveDisposition(triggerId, {
        ...disposition,
        handbacks: [...disposition.handbacks ?? [], { ticketId, reason, at }],
      })
      const stored = this.repo.triggers.get(triggerId)
      if (stored !== undefined && this.followupOwners(stored).length === 0) {
        this.reevaluate(triggerId)
      }
      this.options.events.emit('trigger.followup', { triggerId, ticketId })
    })
  }

  /** Attach a Trigger to an existing Ticket without a new Decision. */
  attach(ticketId: string, triggerId: string, note?: string): Ticket {
    return this.repo.atomic(() => {
      const disposition = this.repo.triggers.disposition(triggerId)
      if (disposition?.handbacks?.some(item => item.ticketId === ticketId) === true) throw new UserError('handedBackHere')
      const ticket = this.repo.tickets.get(ticketId)
      const trigger = this.repo.triggers.get(triggerId)
      if (ticket === undefined) throw new UserError('unknownTicket', { id: ticketId })
      if (trigger === undefined) throw new UserError('unknownTrigger', { id: triggerId })
      if (ticket.ended !== undefined) throw new UserError('alreadyEnded')
      if (!this.options.policy().revalidate(ticket.mandate, trigger)) throw new UserError('policyChanged')
      const at = this.now()
      const inputId = key('input', ticketId, 'trigger', triggerId, note ?? '')
      const updated: Ticket = {
        ...ticket,
        inputs: [...ticket.inputs, { id: inputId, kind: 'trigger', triggerId, at, human: trigger.human, readAt: null, ...(note === undefined ? {} : { note }) }],
        undelivered: [...ticket.undelivered, inputId],
        updatedAt: at,
      }
      this.repo.tickets.save(updated)
      this.wake(ticketId)
      return updated
    })
  }

  /** Wake an ended Ticket when a person's message reached it. */
  private wake(ticketId: string): void {
    const ticket = this.repo.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended === undefined || ticket.ended.by === 'human') return
    const { ended: _cleared, ...withoutEnded } = ticket
    this.repo.tickets.save({
      ...withoutEnded,
      updatedAt: this.now(),
    })
    const input = ticket.inputs.filter(item => 'readAt' in item && item.readAt === null).at(-1)
    if (input !== undefined) this.options.events.emit('ticket.resumed', { id: ticketId, inputId: input.id })
  }
}

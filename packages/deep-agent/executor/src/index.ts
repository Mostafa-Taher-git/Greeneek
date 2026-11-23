/**
 * Real Deep-agent Worker execution. Every Assignment owns one agent session
 * with an isolated working directory, a mandate prompt, and a scoped report
 * tool. Capacity is enforced through a slot registry, and interrupted Work is
 * resumed from its durable session id after a restart.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-workspace'
import { MessageId } from '@greeneek/gnk-llm/brand'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { AgentHandle } from '@greeneek/gnk-agent'
import type { Executor, Ticket, WorkerReport } from '@greeneek/gnk-deep-agent-core'
import { key } from '@greeneek/gnk-deep-agent-core'
import type { ToolRunContext } from '@greeneek/gnk-tools'
import { RECOVERY_NOTE } from './recovery.ts'
export { RouterSession, candidateCard } from './router.ts'
export type { RouterConfig } from './router.ts'

/** Defers an effect without counting a failure; slot exhaustion is normal backpressure. */
export class NoSlot extends Error {
  constructor() { super('No worker slot is free'); this.name = 'NoSlot' }
}

/** Slot accounting. A holder keeps a slot from launch until its Assignment ends. */
export class WorkerSlots {
  private readonly held = new Set<string>()
  private readonly starting = new Set<string>()

  /** @param capacity - maximum simultaneous Workers. */
  constructor(private readonly capacity: number) {}

  /** All tickets currently holding or starting a slot. */
  used(): ReadonlySet<string> { return new Set([...this.held, ...this.starting]) }

  /** How many Workers may still start. */
  free(): number { return Math.max(0, this.capacity - this.used().size) }

  /** Reserve a slot; throws when capacity is exhausted. */
  reserve(ticketId: string, phase: 'launch' | 'wake'): void {
    if (this.used().has(ticketId)) return
    const extra = phase === 'wake' ? 1 : 0
    if (this.used().size >= this.capacity + extra) throw new NoSlot()
    this.starting.add(ticketId)
  }

  /** A reservation became a running Worker. */
  started(ticketId: string): void {
    this.starting.delete(ticketId)
    this.held.add(ticketId)
  }

  /** Release a slot when the Assignment ends. */
  release(ticketId: string): void {
    this.starting.delete(ticketId)
    this.held.delete(ticketId)
  }
}

/** Configuration for the real Worker executor. */
export interface WorkerExecutorConfig {
  /** Root directory for per-Ticket working directories. */
  readonly rootDirectory: string
  /** Maximum simultaneous Workers. */
  readonly maxWorkers: number
  /** Optional preset applied to Worker sessions. */
  readonly workerPreset?: string
  /** Commit a structured report to the domain Engine. */
  readonly onReport: (ticketId: string, assignmentId: string, report: WorkerReport) => void
  /** Called when an agent turn settles, so the domain can observe completion. */
  readonly onSettled?: (ticketId: string, assignmentId: string) => void
  /** Report an infrastructure failure that the domain report path cannot carry. */
  readonly onError?: (message: string) => void
}

/** Deterministic session id of a Worker Assignment, stable across restarts. */
export function workerSessionId(ticketId: string, assignmentId: string): SessionId {
  return key('worker-session', ticketId, assignmentId) as SessionId
}

/** Build the mandate text given to a Worker, from its Ticket's immutable authority. */
export function mandateText(ticket: Ticket): string {
  const mandate = ticket.mandate
  const scope = mandate.basis.via === 'admission' ? `admission cell ${mandate.basis.cell}` : mandate.basis.via
  return [
    `Ticket: ${ticket.title}`,
    `Authority: ${mandate.strength} / ${scope} under policy ${mandate.policyVersion}`,
    `Actor: ${mandate.actor.source}:${mandate.actor.id}`,
    'Work only within this mandate. A follow-up message grants no new permissions.',
    'When finished, call deep_agent_report with a structured report.',
  ].join('\n')
}

/** Real Worker executor backed by owned agent sessions. */
export class AgentWorkerExecutor implements Executor {
  private readonly slots: WorkerSlots
  private readonly handles = new Map<string, AgentHandle>()

  /** @param ctx - Host context that owns the agent fibers. @param config - executor configuration. */
  constructor(private readonly ctx: Context, private readonly config: WorkerExecutorConfig) {
    this.slots = new WorkerSlots(config.maxWorkers)
  }

  /** Current Worker capacity accounting. */
  capacity(): { readonly used: number; readonly free: number } {
    return { used: this.slots.used().size, free: this.slots.free() }
  }

  /** Launch a Worker for one Assignment. */
  start(ticket: Ticket, assignmentId: string): void {
    this.slots.reserve(ticket.id, 'launch')
    void this.launch(ticket, assignmentId).catch((error: unknown) => {
      this.slots.release(ticket.id)
      this.handles.delete(assignmentId)
      const message = error instanceof Error ? error.message : String(error)
      this.config.onError?.(message)
      try {
        this.config.onReport(ticket.id, assignmentId, { state: 'failed', summary: message })
      } catch (reportError: unknown) {
        this.config.onError?.(reportError instanceof Error ? reportError.message : String(reportError))
      }
    })
  }

  private async launch(ticket: Ticket, assignmentId: string): Promise<void> {
    // Agent creation publishes durable session state; run it after the domain
    // transaction that queued this launch has committed.
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    const cwd = join(this.config.rootDirectory, ticket.id)
    mkdirSync(cwd, { recursive: true })
    const sessionId = workerSessionId(ticket.id, assignmentId)
    const setup = this.setup(ticket, assignmentId)
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd, ...(this.config.workerPreset === undefined ? {} : { agentPreset: this.config.workerPreset }) },
      setup,
    })
    this.handles.set(assignmentId, handle)
    this.slots.started(ticket.id)
    handle.agent.followup({
      id: MessageId(key('worker-message', assignmentId, 'mandate')),
      role: 'user',
      content: [{ type: 'text', text: mandateText(ticket) }],
      source: { kind: 'plugin', plugin: 'deep-agent' },
    })
    void handle.agent.whenIdle().then(() => { this.config.onSettled?.(ticket.id, assignmentId) })
  }

  /** Register the mandate prompt and the scoped report tool inside one Worker. */
  private setup(ticket: Ticket, assignmentId: string) {
    return (agentCtx: Context): void => {
      agentCtx.systemPrompt.section({
        name: 'deep-agent-mandate',
        order: 9_000,
        text: mandateText(ticket),
        complete: true,
      })
      agentCtx.tools.register({
        name: 'deep_agent_report',
        description: 'Report the outcome of this ticket. Call once when the work is complete or blocked.',
        parameters: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'] },
            summary: { type: 'string' },
            question: { type: 'string' },
          },
          required: ['state', 'summary'],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', properties: { recorded: { type: 'boolean', const: true } }, required: ['recorded'], additionalProperties: false },
          render: () => [{ type: 'text', text: 'Report recorded.' }],
        },
        execute: (args: unknown, exec: ToolRunContext): Promise<{ recorded: true }> => {
          const input = args as { state: WorkerReport['state']; summary: string; question?: string }
          const report: WorkerReport = {
            state: input.state, summary: input.summary,
            ...(input.question === undefined ? {} : { question: input.question }),
          }
          this.config.onReport(ticket.id, assignmentId, report)
          exec.concludeTurn()
          return Promise.resolve({ recorded: true })
        },
      })
    }
  }

  /** Deliver stored Inputs to the running Worker. */
  deliver(ticket: Ticket, assignmentId: string, inputIds: readonly string[]): void {
    const handle = this.handles.get(assignmentId)
    if (handle === undefined) return
    const inputs = ticket.inputs.filter(input => inputIds.includes(input.id))
    if (inputs.length === 0) return
    const text = inputs.map((input) => {
      if (input.kind === 'trigger') return `[input ${input.id}]${input.note === undefined ? '' : ` note: ${input.note}`}`
      if (input.kind === 'text' || input.kind === 'note') return `[input ${input.id}] ${input.text}`
      return `[input ${input.id}] ${input.kind}`
    }).join('\n')
    handle.agent.followup({ id: MessageId(key('worker-message', assignmentId, inputIds.join(','))),
      role: 'user',
      content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'deep-agent' } })
  }

  /** Cancel a Worker and release its slot. */
  stop(ticket: Ticket, assignmentId: string, reason: string): void {
    const handle = this.handles.get(assignmentId)
    if (handle !== undefined) {
      handle.agent.cancel({ kind: 'hook', reason })
      void handle.dispose().catch(() => { /* teardown is best-effort here */ })
      this.handles.delete(assignmentId)
    }
    void ticket
    this.slots.release(ticket.id)
  }

  /** Resume Workers whose assignments were running before a host restart. */
  async recover(open: readonly Ticket[]): Promise<void> {
    for (const ticket of open) {
      const assignment = ticket.assignments.at(-1)
      if (assignment === undefined || assignment.state !== 'running') continue
      if (this.handles.has(assignment.id)) continue
      this.slots.reserve(ticket.id, 'wake')
      try {
        const cwd = join(this.config.rootDirectory, ticket.id)
        mkdirSync(cwd, { recursive: true })
        const handle = await this.ctx.agents.resume({
          resumeSessionId: workerSessionId(ticket.id, assignment.id),
          setup: this.setup(ticket, assignment.id),
        })
        this.handles.set(assignment.id, handle)
        this.slots.started(ticket.id)
        handle.agent.inject({
          id: MessageId(key('worker-message', assignment.id, 'recovery')),
          role: 'user',
          content: [{ type: 'text', text: RECOVERY_NOTE }],
          source: { kind: 'plugin', plugin: 'deep-agent' },
        })
      } catch (error: unknown) {
        this.slots.release(ticket.id)
        const message = error instanceof Error ? error.message : String(error)
        this.config.onReport(ticket.id, assignment.id, { state: 'failed', summary: `Recovery failed: ${message}` })
      }
    }
  }

  /** Dispose all owned Workers; awaits each agent's quiescence. */
  async dispose(): Promise<void> {
    const handles = [...this.handles.values()]
    this.handles.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
  }
}

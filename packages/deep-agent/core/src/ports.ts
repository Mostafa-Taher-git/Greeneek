/** Ports the Engine requires from its host. Adapted from the reference `src/core/ports.ts`. */
import type {
  ActorRef, ChannelRef, Decision, Mandate, MandateBasis, Strength, Thread, Ticket, Trigger,
  TriggerDisposition,
} from './types.ts'

/** Admission result from a Source-specific scope check. */
export interface ScopeResult { readonly listened: boolean; readonly reason?: string; readonly observed?: boolean }

/** The source-level view used by the policy gate. */
export interface SourceScope {
  readonly scope: (trigger: Trigger) => ScopeResult
  readonly allowed: (actor: ActorRef) => boolean
  readonly bots: (actor: ActorRef) => boolean
  readonly policy?: () => Readonly<Record<string, unknown>>
}

/** Gate decision: whether a Trigger is admissible and, if so, the Mandate basis and strength. */
export type GateResult =
  | { readonly admissible: false; readonly reason: string }
  | { readonly admissible: true; readonly strength: Strength; readonly basis: MandateBasis }

/** An assessor's outcome for one candidate Trigger. */
export interface Candidate {
  readonly trigger: Trigger
  readonly evalId: string
  readonly thread: Thread
  readonly basis: MandateBasis
  readonly strength: Strength
}

export interface AssessmentOutcome {
  readonly accept: boolean
  readonly reason?: string
  readonly matchedRules?: readonly string[]
  readonly audit?: Readonly<Record<string, unknown>>
  readonly directionAllowed?: boolean
  readonly intentEvidence?: boolean
}

export interface Assessor {
  request(candidate: Candidate): void
  cancel?(evalId: string): void
}

/** Versioned policy port. */
export interface Policy {
  readonly version: string
  readonly paused: boolean
  readonly evalTimeoutMs: number
  gate(trigger: Trigger, thread: Thread, tickets: readonly Ticket[]): GateResult
  revalidate(mandate: Mandate, trigger: Trigger): boolean
  admitsInferred(rules: readonly string[]): boolean
}

/** Executor port; operations are effects the host carries out outside the domain transaction. */
export interface Executor {
  start(ticket: Ticket, assignmentId: string): void
  deliver(ticket: Ticket, assignmentId: string, inputIds: readonly string[]): void
  stop(ticket: Ticket, assignmentId: string, reason: string): void
}

export interface OutboundMessage {
  readonly id: string
  readonly channel: ChannelRef
  readonly text: string
  readonly kind: 'acknowledgement' | 'reply' | 'notice'
  readonly ticketId?: string
}

export type ReplyStatus = 'pending' | 'sent' | 'dropped'

export interface Outbox {
  send(message: OutboundMessage): void
}

/** Domain events emitted after commit. */
export interface DomainEvents {
  emit(event: string, value: unknown): void
}

/** Write-side repositories. Every accessor is synchronous and transactions are nested. */
export interface Repositories {
  atomic<T>(fn: () => T): T
  afterCommit(fn: () => void): void
  readonly triggers: {
    get(id: string): Trigger | undefined
    save(trigger: Trigger): void
    disposition(id: string): TriggerDisposition | undefined
    saveDisposition(id: string, value: TriggerDisposition): void
  }
  readonly threads: {
    get(key: string): Thread | undefined
    save(thread: Thread): void
    list(): readonly Thread[]
    active(): readonly Thread[]
  }
  readonly tickets: {
    get(id: string): Ticket | undefined
    save(ticket: Ticket): void
    list(): readonly Ticket[]
    open(): readonly Ticket[]
    active(): readonly Ticket[]
  }
  readonly decisions: {
    get(id: string): Decision | undefined
    save(decision: Decision): void
    byThread(key: string): readonly Decision[]
  }
}

export interface EngineOptions {
  readonly repo: Repositories
  readonly policy: () => Policy
  readonly scopes: Readonly<Record<string, SourceScope>>
  readonly assessor: Assessor
  readonly events: DomainEvents
  readonly outbox: Outbox
  readonly executor: Executor
  readonly now?: () => string
}

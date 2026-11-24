/**
 * Deep-agent domain model, adapted from the reference superagent prototype
 * (`src/core/model.ts`). Field names, state machines, and invariants are
 * preserved. `text` and `meta` on a Trigger are untrusted external data.
 */
import type { Reason } from './reasons.ts'

/** Actor identity in the source's own vocabulary. */
export interface ActorRef { readonly source: string; readonly id: string }
/** Thread identity; the rule deriving `id` from a native event belongs to the Source. */
export interface ThreadRef { readonly source: string; readonly id: string }
/** Write-only address on a Thread; the address format belongs to the Source. */
export interface ChannelRef {
  readonly source: string
  readonly thread: string
  readonly address: Readonly<Record<string, string>>
}

/**
 * Stable key of a Thread across the whole domain.
 * @param ref - Thread reference to key.
 * @returns the `source:id` key.
 */
export const threadKey = (ref: ThreadRef): string => `${ref.source}:${ref.id}`

/**
 * Normalize a valid timestamp to ISO form so stored times compare lexicographically.
 * @param value - timestamp to normalize.
 * @returns the ISO form, or the original string when unparseable.
 */
export function isoTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/** One immutable event produced by a Source. */
export interface Trigger {
  readonly id: string
  readonly source: string
  /** All Threads this Trigger belongs to; threads[0] hosts its Eval. */
  readonly threads: readonly ThreadRef[]
  readonly actor: ActorRef
  /** The event was written by a person, not a bot, CI, or this agent. */
  readonly human: boolean
  /** The sender addressed the agent by mention or direct message. */
  readonly addressed?: 'mention' | 'direct'
  readonly at: string
  readonly text: string
  readonly channel?: ChannelRef
  readonly url?: string
  readonly meta: Readonly<Record<string, unknown>>
}

/** Where a Trigger went after intake; it grants no authority. */
export interface TriggerDisposition {
  readonly filtered?: Reason
  readonly evalId?: string
  readonly decisionId?: string
  readonly fanout: readonly string[]
  /** Tickets reached only on a context Thread, which makes the message none of theirs. */
  readonly context?: readonly string[]
  readonly requeued?: true
  readonly handbacks?: readonly { readonly ticketId: string; readonly reason: string; readonly at: string }[]
  readonly acked?: readonly string[]
  readonly at: string
}

/** Read-only lookups needed to find which Tickets own a person's follow-up. */
export interface FollowupRecords {
  readonly tickets: { get(id: string): Ticket | undefined }
  readonly threads: { get(key: string): Thread | undefined }
  readonly triggers: { disposition(id: string): TriggerDisposition | undefined }
}

/**
 * Tickets whose worker decides a person's follow-up; see the reference `followupOwners`.
 * @param trigger - incoming human Trigger to route.
 * @param records - read-only lookups for dispositions, Threads, and Tickets.
 * @returns identifiers of Tickets that still own the follow-up.
 */
export function followupOwners(trigger: Pick<Trigger, 'id' | 'human' | 'threads'>, records: FollowupRecords): string[] {
  if (!trigger.human) return []
  const disposition = records.triggers.disposition(trigger.id)
  if (disposition === undefined || disposition.requeued === true) return []
  const returned = new Set(disposition.handbacks?.map(item => item.ticketId) ?? [])
  const reached = disposition.fanout.filter(id => !returned.has(id) && !disposition.context?.includes(id))
  const primary = trigger.threads[0]
  if (primary === undefined || reached.length === 0) return []
  const evaluating = records.threads.get(threadKey(primary))?.evaluating
  if (evaluating?.triggerIds.includes(trigger.id) === true) return []
  return reached.filter((id) => {
    const ticket = records.tickets.get(id)
    return ticket !== undefined && (liveTicket(ticket) || (ticket.ended?.by !== 'human'
      && ticket.inputs.some(input => input.kind === 'trigger' && input.triggerId === trigger.id && ticket.undelivered.includes(input.id))))
  })
}

/**
 * Whether a Decision settled a person's message.
 * @param decision - Decision kind and reasons to inspect.
 * @returns true when no stop or routing reason left the message unsettled.
 */
export const settled = (decision: Pick<Decision, 'kind' | 'reason'>): boolean =>
  !['stop', 'unavailable'].includes(decision.kind)
  && !decision.reason.some(reason => ['stopNotExplicit', 'stopUnknown', 'routed'].includes(reason.code))

/** Whether authority came from an explicit request or was inferred from context. */
export type Strength = 'explicit' | 'inferred'
/** Admission-table cell combining sender membership and whether the agent was addressed. */
export type AdmissionCell = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'
/** Policy mode for accepting inferred requests: disabled, observe-only, or automatic. */
export type AcceptMode = 'off' | 'observe' | 'auto'

interface Received { readonly source?: string; readonly scope?: Readonly<Record<string, unknown>>; readonly row?: string }

/** How the gate admitted the Trigger behind a Mandate; `revalidate` re-checks it. */
export type MandateBasis = Received & { readonly sender?: string; readonly rules?: readonly string[] } & (
  | { readonly via: 'addressed'; readonly addressed: 'mention' | 'direct' }
  | { readonly via: 'followup'; readonly authority?: string }
  | { readonly via: 'admission'; readonly cell: AdmissionCell; readonly addressed?: 'mention' | 'direct'; readonly observation?: { readonly mode: AcceptMode } }
  | { readonly via: 'listed'; readonly addressed?: 'mention' | 'direct'; readonly observation?: { readonly mode?: AcceptMode }; readonly authority?: string }
  | { readonly via: 'bot'; readonly addressed?: 'mention' | 'direct'; readonly observation: { readonly mode: AcceptMode } }
)

/** Immutable authorization produced by an accept decision. */
export interface Mandate {
  readonly strength: Strength
  readonly policyVersion: string
  readonly basis: MandateBasis
  readonly actor: ActorRef
  readonly scope: string
}

/** Active Trigger evaluation on a Thread; at most one per Thread. */
export interface Evaluation {
  readonly id: string
  readonly threadKey: string
  readonly triggerIds: readonly string[]
  readonly primary?: string
  readonly strength: Strength
  readonly actor: ActorRef
  readonly basis: MandateBasis
  readonly policyVersion: string
  readonly startedAt: string
  readonly delivered?: string
  readonly deadline: string
  readonly pausedAt?: string
}

/** Kind of Decision recorded for an Eval; `reopen` is retained for stored records. */
export type DecisionKind = 'ignore' | 'accept' | 'reopen' | 'stop' | 'unavailable'

/** Audited outcome of an Eval. `reopen` is a legacy kind retained for stored records. */
export interface Decision {
  readonly id: string
  readonly evalId: string
  readonly threadKey: string
  readonly triggerIds: readonly string[]
  readonly policyVersion: string
  readonly at: string
  readonly kind: DecisionKind
  readonly reason: readonly Reason[]
  readonly strength: Strength
  readonly ticketId?: string
  readonly mandate?: Mandate
  readonly audit?: Readonly<Record<string, unknown>>
  readonly dismissed?: string
}

/** One labeled fact displayed in a Thread's status. */
export type ThreadFact = { readonly label?: string; readonly value: string; readonly problem?: boolean }

/** Ordered Triggers of one Thread; the Eval consistency boundary. */
export interface Thread {
  readonly key: string
  readonly ref: ThreadRef
  readonly createdAt: string
  readonly lastAt?: string
  readonly subscriptions: readonly string[]
  /** Context-only subscriptions lend no authority. */
  readonly context?: readonly string[]
  readonly correlated: readonly string[]
  /** Debounce buffer of Trigger ids awaiting an Eval. */
  readonly pending: readonly string[]
  readonly evaluating?: Evaluation
  readonly expired?: number
  readonly meta: Readonly<Record<string, unknown>>
  readonly label?: string
  readonly url?: string
  readonly facts?: readonly ThreadFact[]
}

/** State a worker reports for its current Assignment. */
export type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'

/** A worker's structured report. */
export interface WorkerReport {
  readonly state: ReportState
  readonly summary: string
  readonly question?: string | null
  readonly askedBy?: string
  readonly answers?: readonly string[]
}

/** One attempt by the Executor to run a Ticket under its Mandate. */
export interface Assignment {
  readonly id: string
  readonly state: 'pending' | 'running' | 'ended'
  readonly createdAt: string
  readonly startedAt?: string
  readonly endedAt?: string
  readonly endedReason?: string
  readonly report?: WorkerReport & { readonly at: string }
  readonly deliveredAt?: string
  readonly idleAt?: string
}

/** One immutable item delivered into a Ticket: a Trigger, policy change, or control event. */
export type TicketInput =
  | { readonly id: string; readonly kind: 'trigger'; readonly triggerId: string; readonly at: string; readonly note?: string; readonly human?: boolean; readonly context?: boolean; readonly readAt?: string | null; readonly deliveredTo?: string; readonly deliveredAt?: string }
  | { readonly id: string; readonly kind: 'policy-changed'; readonly from: string; readonly to: string; readonly at: string; readonly effect?: PolicyEffect }
  | { readonly id: string; readonly kind: 'reopen'; readonly decisionId: string; readonly at: string }
  | { readonly id: string; readonly kind: 'resumed'; readonly triggerId: string; readonly at: string }
  | { readonly id: string; readonly kind: 'text'; readonly text: string; readonly at: string }
  | { readonly id: string; readonly kind: 'note'; readonly text: string; readonly at: string }

/** Policy changes recorded on a Ticket input when a Mandate is revalidated. */
export interface PolicyEffect {
  readonly rules?: readonly { readonly id: string; readonly name: string; readonly change: 'changed' | 'disabled'; readonly instruction?: string }[]
  readonly proactive?: false
  readonly requesterAllowed?: false
  readonly requester?: ActorRef
}

/** Outcome recorded when a Ticket ends. */
export type TicketOutcome = 'completed' | 'merged' | 'closed' | 'dropped' | 'stopped'

/** A Thread a Ticket follows, and whether its closure has been observed. */
export interface Follow { readonly threadKey: string; readonly own: boolean; readonly closed?: { readonly at: string; readonly outcome: 'merged' | 'closed' } }

/** A unit of authorized work, carrying its authority in its Mandate. */
export interface Ticket {
  readonly id: string
  readonly title: string
  readonly decisionId: string
  readonly mandate: Mandate
  readonly channels: readonly ChannelRef[]
  readonly ended?: { readonly at: string; readonly by: 'executor' | 'human'; readonly outcome: TicketOutcome; readonly reason?: string }
  readonly attention?: { readonly id: string; readonly question: string; readonly triggerId?: string }
  readonly assignments: readonly Assignment[]
  readonly inputs: readonly TicketInput[]
  readonly undelivered: readonly string[]
  readonly follows?: readonly Follow[]
  readonly answers?: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly origin: { readonly triggerId: string; readonly triggerIds: readonly string[] }
  readonly execution?: { readonly name: string; readonly directory: string; readonly assignment: string }
  readonly delivery?: { readonly error: string; readonly at: string }
}

/**
 * The newest Assignment of a Ticket.
 * @param ticket - Ticket whose assignments are inspected.
 * @returns the last Assignment, or undefined when none exists.
 */
export const latestAssignment = (ticket: Ticket): Assignment | undefined => ticket.assignments.at(-1)

/**
 * Whether an open Ticket is stalled on a blocked/failed report without a newer human follow-up.
 * A blocked or failed report holds automated Inputs until a person, retry, or a non-blocked report arrives.
 * @param ticket - Ticket whose latest report and Inputs are inspected.
 * @returns true when a person must act before the work continues.
 */
export function waitsForPerson(ticket: Ticket): boolean {
  const assignment = latestAssignment(ticket)
  const state = assignment?.report?.state
  if (state !== 'blocked' && state !== 'failed') return false
  const reportAt = assignment?.report?.at
  return !ticket.inputs.some(input => 'human' in input && input.human && input.at > (reportAt ?? ''))
}

/**
 * Whether a Ticket can still receive work.
 * @param ticket - Ticket to check.
 * @returns true while the Ticket has no end record.
 */
export const liveTicket = (ticket: Ticket): boolean => ticket.ended === undefined

/** Browser-safe projections of Deep-agent operational state. */
import type {
  Decision, Thread, Ticket, Trigger, TriggerDisposition,
} from '@greeneek/gnk-deep-agent-core'

/** Wire-safe manual event; untrusted source metadata is never accepted from the browser. */
export interface TriggerInput {
  readonly id: string
  readonly source: string
  readonly threads: readonly { readonly source: string; readonly id: string }[]
  readonly actor: { readonly source: string; readonly id: string }
  readonly human: boolean
  readonly addressed?: 'mention' | 'direct'
  readonly at: string
  readonly text: string
  readonly channel?: { readonly source: string; readonly thread: string; readonly address: Readonly<Record<string, string>> }
}

/** A decision an operator records for a candidate event. */
export interface DecisionInput {
  readonly triggerId: string
  readonly evalId?: string
  readonly accept: boolean
  readonly reason: string
  readonly matchedRules?: readonly string[]
}

/** One row of the management overview. */
export interface DeepAgentState {
  readonly lastError?: string
  readonly configured: boolean
  readonly paused: boolean
  readonly policyVersion: string
  readonly mode: 'off' | 'observe' | 'auto'
  readonly counts: {
    readonly triggers: number
    readonly threads: number
    readonly tickets: number
    readonly openTickets: number
    readonly decisions: number
    readonly pendingEffects: number
  }
}

/** A compact ticket row for the panel. */
export interface TicketRow {
  readonly id: string
  readonly title: string
  readonly stage: string
  readonly status: 'open' | 'ended'
  readonly outcome?: string
  readonly strength: string
  readonly actor: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly attention?: string
  readonly undelivered: number
}

/** A compact decision row with its audit reasons. */
export interface DecisionRow {
  readonly id: string
  readonly kind: string
  readonly at: string
  readonly threadKey: string
  readonly reasons: readonly string[]
  readonly ticketId?: string
}

/** A compact browser-safe trigger row; untrusted source metadata is not exposed. */
export interface TriggerRow {
  readonly id: string
  readonly source: string
  readonly actor: string
  readonly human: boolean
  readonly at: string
  readonly text: string
  readonly threads: readonly string[]
  readonly evalId?: string
  readonly fanout: readonly string[]
}

export type { Decision, Thread, Ticket, Trigger, TriggerDisposition }

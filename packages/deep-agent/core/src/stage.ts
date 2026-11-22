/** Ticket stage classification and retry eligibility (reference docs/003). */
import { latestAssignment, waitsForPerson, type Ticket } from './types.ts'

export type TicketStage = { readonly stage: 'person'; readonly action: 'delivery' | 'answer' | 'review' | 'blocked' | 'failed' }
  | { readonly stage: 'working'; readonly action?: 'queued' }
  | { readonly stage: 'idle' }
  | { readonly stage: 'ended' }

/** First matching row wins, in the order of the reference stage table. */
export function ticketStage(ticket: Ticket): TicketStage {
  if (ticket.ended !== undefined) return { stage: 'ended' }
  if (ticket.delivery !== undefined) return { stage: 'person', action: 'delivery' }
  if (ticket.attention !== undefined) return { stage: 'person', action: 'answer' }
  const assignment = latestAssignment(ticket)
  const state = assignment?.report?.state
  if (state === 'ready') return { stage: 'person', action: 'review' }
  if ((state === 'blocked' || state === 'failed') && waitsForPerson(ticket)) return { stage: 'person', action: state }
  if (assignment === undefined || assignment.state === 'pending') return { stage: 'working', action: 'queued' }
  if (state === 'waiting' || assignment.state === 'ended') return { stage: 'idle' }
  return { stage: 'working' }
}

/** True for a Ticket stalled on a person or on a failed delivery. */
export function canRetry(ticket: Ticket): boolean {
  return ticket.ended === undefined && (waitsForPerson(ticket) || ticket.delivery !== undefined)
}

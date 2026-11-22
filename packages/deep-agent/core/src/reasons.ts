/** Stable reason codes recorded on Decisions, dispositions, and Trigger requeues. */
export interface Reason {
  readonly code: string
  readonly values?: Readonly<Record<string, string>>
  readonly triggerId?: string
}

/** Human-readable text for a reason code, with `{name}` placeholders. */
export const REASONS: Readonly<Record<string, string>> = {
  timeout: 'The assessment deadline passed',
  policyChanged: 'The Policy changed while the assessment was running',
  noAdmissible: 'No Trigger in the batch was admissible',
  startedTicket: 'A Trigger in the batch already started a Ticket',
  acceptedBefore: 'This Trigger was already accepted',
  routed: 'The message was routed to an existing Ticket',
  explicitRouted: 'An explicit message was routed to an existing Ticket',
  humanStop: 'Stopped by a person',
  hostRestarted: 'The host restarted during the assignment',
  stopUnknown: 'The stopped Ticket is unknown',
  stopNotExplicit: 'A stop requires an explicit request',
  directionUnsettled: 'The request direction is not settled',
  noRuleMatched: 'No enabled Policy rule matched',
  ignoredFromCard: 'The event card touches no enabled rule',
  observed: 'Would have been accepted under observe mode',
  notAMember: 'The sender is not on the allowed list',
  admissionIgnored: 'The admission table ignores this message',
  noMention: 'The sender did not address the agent',
  senderNotAllowed: 'The sender is not allowed on this Source',
  botNotListed: 'The bot is not on the Source bot list',
  filtered: 'The Source scope filtered this event',
  requeued: 'The Trigger was sent for a fresh assessment',
  retried: 'The stalled Assignment was retried',
}

/** Format a Reason as text, substituting its values. */
export function reasonText(reason: Reason): string {
  const text = REASONS[reason.code] ?? reason.code
  return text.replace(/\{(\w+)\}/g, (match, name: string) => reason.values?.[name] ?? match)
}

/** Whether a reason code was recorded. */
export const said = (reason: Reason | undefined, code: string): boolean => reason?.code === code

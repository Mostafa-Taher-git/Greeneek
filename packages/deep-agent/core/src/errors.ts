/** User-facing domain errors, adapted from the prototype's `src/core/errors.ts`. */
export const USER_ERRORS = {
  unknownTrigger: ['missing', 'Trigger not found: {id}'],
  unknownTicket: ['missing', 'Ticket not found: {id}'],
  unknownDecision: ['missing', 'Decision not found: {id}'],
  unknownEval: ['missing', 'Assessment not found: {id}'],
  unknownThread: ['missing', 'Thread not found: {key}'],
  evalFinished: ['refused', 'That assessment has finished'],
  notAdmissible: ['refused', 'The event is not admissible'],
  notPrimary: ['refused', 'Only the admissible Trigger selected for this assessment can be decided'],
  workerDecides: ['refused', 'A worker on the thread decides this message; only a stop goes through routing'],
  notExplicit: ['refused', 'Accepting an inferred request requires auto mode and an enabled matching rule'],
  handedBackHere: ['refused', 'The worker handed this event back; accept it as new work or ignore it'],
  handedBack: ['refused', 'This Ticket already handed that event back'],
  notFollowing: ['refused', 'This Ticket does not follow that Thread'],
  followedThread: ['refused', 'This is the Ticket\'s own Thread and stays subscribed'],
  questionWithResult: ['refused', 'A question for a person cannot also be a ready result'],
  notReached: ['refused', 'That event did not reach this worker'],
  notReady: ['refused', 'The Ticket is not ready for delivery'],
  noChannel: ['refused', 'No reply channel for this Ticket or event'],
  notRetryable: ['refused', 'This Ticket is not retryable'],
  alreadyEnded: ['refused', 'The Ticket has ended'],
  stoppedTicket: ['refused', 'This Ticket was stopped and withdraws its Mandate'],
  policyChanged: ['refused', 'The Policy no longer holds this Mandate'],
  setupIncomplete: ['refused', 'Deep-agent setup is not complete'],
} as const satisfies Record<string, readonly ['missing' | 'refused', string]>

/** Codes naming a user-facing domain error and its message template. */
export type UserErrorCode = keyof typeof USER_ERRORS

/** Structured error thrown by the Engine and application services. */
export class UserError extends Error {
  /** Whether the referenced entity was not found, rather than the call being refused. */
  readonly missing: boolean
  constructor(readonly code: UserErrorCode, readonly values: Readonly<Record<string, string>> = {}) {
    const [kind, text] = USER_ERRORS[code]
    super(text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match))
    this.name = 'UserError'
    this.missing = kind === 'missing'
  }
}

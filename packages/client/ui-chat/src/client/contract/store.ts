/** Chat-owned selection state shared by the transcript and details panel. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** Selection target for the Chat details linkage channel. */
export interface SelectionTarget {
  turnSeq: number
  stepSeq?: number
  callId?: ToolCallId
  toolName?: string
}

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly answerStep: number
}

/** Body the details panel shows while more than one surface competes for it. */
export type DetailsTab = 'tool' | 'fleet'

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  selection: SelectionTarget | null
  turnProcesses: TurnProcessViewEntry[]
  /**
   * Explicit details-tab choice. `null` is the panel's default Tool body, and
   * selecting a Tool call in the transcript returns the panel to that default.
   */
  detailsTab: DetailsTab | null
}

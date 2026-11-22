/** Wire and durable types for Host-wide automation tasks. Types only. */

/** Lifecycle status of one automation task. */
export type AutomationTaskStatus = 'active' | 'paused' | 'ended'

/** Where the task's prompt is delivered. */
export interface AutomationTaskTarget {
  /** Reuse one session created for this task; or an existing session id. */
  readonly kind: 'new_once' | 'session'
  /** Session id when kind is 'session'. */
  readonly sessionId: string | null
  /** Workspace directory for a new session. */
  readonly cwd: string | null
}

/** When the task runs. */
export interface AutomationTaskTiming {
  /** Repeat rule. */
  readonly repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  /** ISO timestamp for a one-shot run. */
  readonly at: string | null
  /** IANA time zone for recurring runs. */
  readonly timeZone: string
}

/** One durable automation task. */
export interface AutomationTask {
  /** Opaque task id. */
  readonly id: string
  /** Display name. */
  readonly title: string
  /** Prompt delivered when the task runs. */
  readonly prompt: string
  /** Current status. */
  readonly status: AutomationTaskStatus
  /** Delivery target. */
  readonly target: AutomationTaskTarget
  /** Run timing. */
  readonly timing: AutomationTaskTiming
  /** Creation time (ISO). */
  readonly createdAt: string
  /** Last update time (ISO), used as the optimistic-concurrency token. */
  readonly updatedAt: string
  /** Last run time (ISO), when any. */
  readonly lastRunAt: string | null
}

/** Request to create one task. */
export interface AutomationCreateRequest {
  readonly title: string
  readonly prompt: string
  readonly cwd: string | null
  readonly repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  readonly at: string | null
  readonly timeZone: string | null
}

/** Request to edit a task (status and identity only in this increment). */
export interface AutomationEditRequest {
  readonly id: string
  readonly status: AutomationTaskStatus | null
  readonly expectedUpdatedAt: string
}

/** Request addressed to one task. */
export interface AutomationTaskRequest {
  readonly id: string
}

/** Snapshot of all tasks, for a settings UI. */
export interface AutomationCatalog {
  readonly tasks: readonly AutomationTask[]
}

/** Machine-readable automation error codes. */
export type AutomationErrorCode =
  | 'AUTOMATION_NOT_FOUND'
  | 'AUTOMATION_CONFLICT'
  | 'AUTOMATION_INVALID'
  | 'AUTOMATION_IO'

/** Wire and durable types for Host-wide automation tasks. Types only. */

import type { Branded } from '@greeneek/gnk-brand'
import type { SessionId } from '@greeneek/gnk-session/types'

/** Identifies one automation execution. */
export type AutomationRunId = Branded<'AutomationRunId'>

/**
 * Brand an execution id.
 * @param id - raw execution id.
 * @returns the same id, branded.
 */
export function AutomationRunId(id: string): AutomationRunId {
  return id as AutomationRunId
}

/** Lifecycle status of one automation task. */
export type AutomationTaskStatus = 'active' | 'paused' | 'ended'

/** Where the task's prompt is delivered. */
export interface AutomationTaskTarget {
  /** Reuse one session created for this task; or an existing session id. */
  readonly kind: 'new_once' | 'session'
  /** Session id when kind is 'session'. */
  readonly sessionId: SessionId | null
  /** Workspace directory for a new session. */
  readonly cwd: string | null
}

/** When the task runs. */
export interface AutomationTaskTiming {
  /** Repeat rule. */
  readonly repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  /** First scheduled instant; recurring tasks use its local clock and weekday. */
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
  /** Last execution start time (ISO), when any. */
  readonly lastRunAt: string | null
  /** Completed and interrupted executions, newest last. */
  readonly history: readonly AutomationRun[]
}

/** Durable outcome of one manual or scheduled execution. */
export interface AutomationRun {
  /** Unique execution id. */
  readonly id: AutomationRunId
  /** Scheduled occurrence timestamp, absent for a manual run. */
  readonly scheduledAt: string | null
  /** Run state. */
  readonly status: 'running' | 'succeeded' | 'failed'
  /** Dispatch time. */
  readonly startedAt: string
  /** Completion time, or null while running. */
  readonly completedAt: string | null
  /** Owned session id used for this execution. */
  readonly sessionId: SessionId
  /** Final assistant text on success. */
  readonly result: string | null
  /** Failure details. */
  readonly error: string | null
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
  | 'AUTOMATION_EXECUTION'

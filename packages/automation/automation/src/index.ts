/**
 * Host-wide automation tasks (`ctx.automation`): durable task records with
 * status, exposed through a read/write Remote for a settings UI. This is a new
 * Host-wide seam and deliberately does not touch the session-local `schedule`
 * domain, whose only durable state is its own versioned event stream.
 * @module @greeneek/gnk-automation
 */
import { Context } from '@greeneek/cordis'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { AutomationError } from './error.ts'
import { defaultAutomationFile, readTasks, writeTasks } from './store.ts'
import type {
  AutomationCatalog, AutomationCreateRequest, AutomationEditRequest,
  AutomationErrorCode, AutomationTask, AutomationTaskRequest,
} from './types.ts'

export { AutomationError } from './error.ts'
export type {
  AutomationCatalog, AutomationCreateRequest, AutomationEditRequest, AutomationErrorCode,
  AutomationTask, AutomationTaskRequest, AutomationTaskStatus, AutomationTaskTarget, AutomationTaskTiming,
} from './types.ts'

declare module '@greeneek/cordis' {
  interface Context {
    /** Host-wide automation task authority. */
    automation: AutomationService
  }
}

/** Browser-visible event emitted after any committed task change. */
export const AUTOMATION_CHANGED = 'automation/changed'

declare module '@greeneek/cordis' {
  interface Events {
    /**
     * A Host-wide automation task changed; listeners may refresh their catalog.
     * @mode emit
     * @param catalog - the updated task catalog.
     */
    'automation/changed'(catalog: AutomationCatalog): void
  }
}

/** Configuration for the automation service. */
export interface AutomationServiceConfig {
  /** Task store file location. */
  readonly file: string
}

/** The automation service: durable CRUD with optimistic concurrency. */
export class AutomationService extends TypertRemoteService {
  /** @param ctx - Host context. @param config - resolved service config. */
  constructor(ctx: Context, config: AutomationServiceConfig = { file: defaultAutomationFile() }) {
    super(ctx, 'automationService', { namespace: 'automation' })
    this.file = config.file
  }
  /** Task store file location. */
  private readonly file: string

  /**
   * All tasks.
   * @returns the current task catalog.
   */
  @Remote('list')
  list(): AutomationCatalog {
    return { tasks: readTasks(this.file) }
  }

  /**
   * Create one task.
   * @param request - title, instruction, target and timing.
   * @returns the created task.
   */
  @Remote('create')
  create(request: AutomationCreateRequest): AutomationTask {
    const title = request.title.trim()
    const prompt = request.prompt.trim()
    if (title.length === 0 || prompt.length === 0) {
      throw this.error('AUTOMATION_INVALID', 'title and instruction are required')
    }
    if (!['once', 'hourly', 'daily', 'weekly'].includes(request.repeat)) {
      throw this.error('AUTOMATION_INVALID', `unsupported repeat ${request.repeat}`)
    }
    if (request.repeat === 'once') {
      const at = request.at === null ? Number.NaN : Date.parse(request.at)
      if (!Number.isFinite(at)) {
        throw this.error('AUTOMATION_INVALID', 'a valid date and time is required for a one-time task')
      }
    }
    const now = new Date().toISOString()
    const task: AutomationTask = {
      id: `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title, prompt, status: 'active',
      target: { kind: 'new_once', cwd: request.cwd, sessionId: null },
      timing: {
        repeat: request.repeat,
        at: request.at,
        timeZone: request.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      lastRunAt: null,
      createdAt: now, updatedAt: now,
    }
    writeTasks(this.file, [...readTasks(this.file), task])
    this.publish()
    return task
  }

  /**
   * Edit status with optimistic concurrency.
   * @param request - task id, expected revision and optional new status.
   * @returns the updated task.
   */
  @Remote('edit')
  edit(request: AutomationEditRequest): AutomationTask {
    const tasks = readTasks(this.file)
    const index = tasks.findIndex(t => t.id === request.id)
    const existing = tasks[index]
    if (existing === undefined) throw this.error('AUTOMATION_NOT_FOUND', `unknown task ${request.id}`)
    if (existing.updatedAt !== request.expectedUpdatedAt) {
      throw this.error('AUTOMATION_CONFLICT', `task ${request.id} changed elsewhere`)
    }
    const updated: AutomationTask = {
      ...existing,
      ...(request.status === null ? {} : { status: request.status }),
      updatedAt: new Date().toISOString(),
    }
    tasks[index] = updated
    writeTasks(this.file, tasks)
    this.publish()
    return updated
  }

  /**
   * Record a manual run now (delivery is a later increment).
   * @param request - task id.
   * @returns the updated task.
   */
  @Remote('run')
  run(request: AutomationTaskRequest): AutomationTask {
    const tasks = readTasks(this.file)
    const index = tasks.findIndex(t => t.id === request.id)
    const existing = tasks[index]
    if (existing === undefined) throw this.error('AUTOMATION_NOT_FOUND', `unknown task ${request.id}`)
    const updated: AutomationTask = {
      ...existing, lastRunAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    tasks[index] = updated
    writeTasks(this.file, tasks)
    this.publish()
    return updated
  }

  /**
   * Delete a task.
   * @param request - task id.
   * @returns the remaining task catalog.
   */
  @Remote('delete')
  delete(request: AutomationTaskRequest): AutomationCatalog {
    const remaining = readTasks(this.file).filter(t => t.id !== request.id)
    writeTasks(this.file, remaining)
    this.publish()
    return { tasks: remaining }
  }

  private publish(): void {
    ;(this.ctx.emit as (name: string, value: AutomationCatalog) => void)(AUTOMATION_CHANGED, this.list())
  }

  private error(code: AutomationErrorCode, message: string): AutomationError {
    return new AutomationError(code, message)
  }
}

export default AutomationService

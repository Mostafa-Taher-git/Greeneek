/**
 * Host-wide automation tasks (`ctx.automation`): scheduled instruction
 * execution through owned Agents with durable result history. Session-local
 * reminders remain in the `schedule` domain.
 * @module @greeneek/gnk-automation
 */
import { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { createUserMessage } from '@greeneek/gnk-llm'
import { installModelSelection } from '@greeneek/gnk-agent'
import type { AgentHandle } from '@greeneek/gnk-agent'
import { SessionId } from '@greeneek/gnk-session'
import type {} from '@greeneek/gnk-agent'
import type {} from '@greeneek/gnk-agent-default-model'
import type {} from '@greeneek/gnk-session-persistence'
import { AutomationError } from './error.ts'
import { defaultAutomationFile, readTasks, writeTasks } from './store.ts'
import { nextOccurrence } from './timing.ts'
import type {
  AutomationCatalog, AutomationCreateRequest, AutomationEditRequest, AutomationRun,
  AutomationErrorCode, AutomationTask, AutomationTaskRequest,
} from './types.ts'
import { AutomationRunId } from './types.ts'

export { AutomationError } from './error.ts'
export { AutomationRunId } from './types.ts'
export type {
  AutomationCatalog, AutomationCreateRequest, AutomationEditRequest, AutomationErrorCode,
  AutomationRun, AutomationTask, AutomationTaskRequest, AutomationTaskStatus, AutomationTaskTarget, AutomationTaskTiming,
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
  /** Task store file location; defaults to the automation file under `$GNK_HOME`. */
  readonly file?: string
  /** Delay between due-task scans; defaults to 30 seconds. */
  readonly pollIntervalMs?: number
}

/** The automation service: durable task execution, scheduling, and history. */
export class AutomationService extends TypertRemoteService {
  static Config: z<AutomationServiceConfig> = z.object({
    file: z.string(),
    pollIntervalMs: z.natural().default(30_000),
  })

  /** @param ctx - Host context. @param config - resolved service config. */
  constructor(ctx: Context, config: AutomationServiceConfig = {}) {
    super(ctx, 'automationService', { namespace: 'automation' })
    this.file = config.file ?? defaultAutomationFile()
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1) {
      throw new TypeError('automation pollIntervalMs must be a positive safe integer')
    }
    this.recoverInterruptedRuns()
    ctx.effect(() => {
      const dependencies = ctx.inject(['agents', 'agentDefaultModel', 'sessionPersistence'], (runtimeCtx) => {
        this.runtimeCtx = runtimeCtx
        this.armScheduler()
      })
      return async () => {
        this.stopped = true
        if (this.timer !== undefined) clearTimeout(this.timer)
        // Unload owns every run it started; a task must not keep using its
        // Agent after the host that owned it has torn down.
        for (const activity of this.running.values()) {
          activity.controller.abort('automation host unloading')
          if (activity.handle !== undefined) await activity.handle.dispose().catch(() => {})
        }
        this.running.clear()
        await dependencies.dispose()
      }
    }, 'automation.scheduler()')
  }
  /** Task store file location. */
  private readonly file: string
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private runtimeCtx: Context | undefined
  private readonly running = new Map<string, { controller: AbortController; handle?: AgentHandle }>()

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
    if (request.cwd !== null && !isAbsolute(request.cwd)) {
      throw this.error('AUTOMATION_INVALID', 'workspace directory must be absolute')
    }
    if (!['once', 'hourly', 'daily', 'weekly'].includes(request.repeat)) {
      throw this.error('AUTOMATION_INVALID', `unsupported repeat ${request.repeat}`)
    }
    const at = request.at === null ? Number.NaN : Date.parse(request.at)
    if (!Number.isFinite(at)) {
      throw this.error('AUTOMATION_INVALID', 'a valid first run date and time is required')
    }
    const timeZone = request.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    try { new Intl.DateTimeFormat('en', { timeZone }) } catch {
      throw this.error('AUTOMATION_INVALID', `unsupported time zone ${timeZone}`)
    }
    const now = new Date().toISOString()
    const task: AutomationTask = {
      id: `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title, prompt, status: 'active',
      target: { kind: 'new_once', cwd: request.cwd, sessionId: null },
      timing: {
        repeat: request.repeat,
        at: request.at,
        timeZone,
      },
      lastRunAt: null,
      history: [],
      createdAt: now, updatedAt: now,
    }
    writeTasks(this.file, [...readTasks(this.file), task])
    this.publish()
    this.armScheduler()
    return task
  }

  /**
   * Update task status with optimistic concurrency.
   * @param request - task id, expected revision and optional new status.
   * @returns the updated task after execution has settled.
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
    this.armScheduler()
    return updated
  }

  /**
   * Execute the instruction in an owned session and return the persisted task.
   * @param request - task id.
   * @returns the updated task after execution has settled.
   */
  @Remote('run')
  async run(request: AutomationTaskRequest): Promise<AutomationTask> {
    return this.execute(request.id, null)
  }

  /**
   * Delete a task.
   * @param request - task id.
   * @returns the remaining task catalog.
   */
  @Remote('delete')
  delete(request: AutomationTaskRequest): AutomationCatalog {
    const active = this.running.get(request.id)
    active?.controller.abort()
    if (active?.handle !== undefined) void active.handle.dispose().catch(() => {})
    const remaining = readTasks(this.file).filter(t => t.id !== request.id)
    writeTasks(this.file, remaining)
    this.publish()
    this.armScheduler()
    return { tasks: remaining }
  }

  private async execute(id: string, scheduledAt: string | null): Promise<AutomationTask> {
    if (this.running.has(id)) throw this.error('AUTOMATION_EXECUTION', `task ${id} is already running`)
    const tasks = readTasks(this.file)
    const index = tasks.findIndex(task => task.id === id)
    const task = tasks[index]
    if (task === undefined) throw this.error('AUTOMATION_NOT_FOUND', `unknown task ${id}`)
    if (scheduledAt !== null && task.history.some(run => run.scheduledAt === scheduledAt)) return task
    const startedAt = new Date().toISOString()
    const sessionId = task.target.sessionId ?? SessionId(`automation-${randomUUID()}`)
    const run: AutomationRun = {
      id: AutomationRunId(randomUUID()), scheduledAt, status: 'running', startedAt,
      completedAt: null, sessionId, result: null, error: null,
    }
    const claimed: AutomationTask = {
      ...task,
      lastRunAt: startedAt, updatedAt: startedAt, history: [...task.history, run],
    }
    tasks[index] = claimed
    writeTasks(this.file, tasks)
    this.publish()
    const activity: { controller: AbortController; handle?: AgentHandle } = {
      controller: new AbortController(),
    }
    this.running.set(id, activity)
    let handle: AgentHandle | undefined
    let result: string | null = null
    let failure: string | null = null
    try {
      const runtimeCtx = this.runtimeCtx
      if (runtimeCtx === undefined) throw new Error('automation execution services are not ready')
      const selection = await runtimeCtx.agentDefaultModel.resolveSelection()
      if (selection === undefined) throw new Error('no model is configured for automation execution')
      const options = {
        agentOptions: {
          provider: selection.provider, model: selection.model,
          ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
        },
        setup: (agentCtx: Context) => {
          installModelSelection(agentCtx, { current: selection, assembled: undefined })
        },
        signal: activity.controller.signal,
      }
      handle = task.target.sessionId === null
        ? await runtimeCtx.agents.create({
          ...options, sessionId, meta: { cwd: task.target.cwd ?? process.cwd() },
        })
        : await runtimeCtx.agents.resume({ ...options, resumeSessionId: sessionId })
      activity.handle = handle
      if (task.target.sessionId === null) this.recordOwnedSession(id, sessionId)
      activity.controller.signal.throwIfAborted()
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: task.prompt }],
        source: { kind: 'plugin', plugin: 'automation' },
      }))
      await handle.agent.whenIdle()
      const events = handle.agent.session.ownEvents()
      const ended = events.findLast(event => event.type === 'turn/end')
      if (ended?.type !== 'turn/end' || ended.data.reason.kind !== 'completed') {
        if (ended?.type === 'turn/end' && ended.data.reason.kind === 'error') {
          throw new Error(ended.data.reason.error.message)
        }
        throw new Error(ended?.type === 'turn/end' ? `agent turn ${ended.data.reason.kind}` : 'agent turn did not complete')
      }
      result = events.filter(event => event.type === 'assistant/message' && event.data.turn === ended.data.turn)
        .map(event => event.type === 'assistant/message'
          ? event.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('')
          : '').join('')
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error)
    } finally {
      if (handle !== undefined) await handle.dispose().catch(() => {})
      if (this.running.get(id) === activity) this.running.delete(id)
    }
    const completedAt = new Date().toISOString()
    const latest = readTasks(this.file)
    const latestIndex = latest.findIndex(value => value.id === id)
    const current = latest[latestIndex]
    if (current === undefined) throw this.error('AUTOMATION_NOT_FOUND', `task ${id} was deleted while running`)
    const history = current.history.map(value => value.id !== run.id ? value : {
      ...value, status: failure === null ? 'succeeded' as const : 'failed' as const,
      completedAt, result, error: failure,
    })
    const updated: AutomationTask = {
      ...current,
      status: current.timing.repeat === 'once' ? 'ended' : current.status,
      updatedAt: completedAt, history,
    }
    latest[latestIndex] = updated
    writeTasks(this.file, latest)
    this.publish()
    if (failure !== null) throw this.error('AUTOMATION_EXECUTION', failure)
    this.armScheduler()
    return updated
  }

  private recordOwnedSession(id: string, sessionId: AutomationTask['target']['sessionId']): void {
    if (sessionId === null) return
    const tasks = readTasks(this.file)
    const index = tasks.findIndex(task => task.id === id)
    const task = tasks[index]
    if (task === undefined) return
    const updated = { ...task, target: { ...task.target, sessionId }, updatedAt: new Date().toISOString() }
    tasks[index] = updated
    writeTasks(this.file, tasks)
    this.publish()
  }

  private recoverInterruptedRuns(): void {
    const tasks = readTasks(this.file)
    const recovered = tasks.map((task) => {
      if (!task.history.some(run => run.status === 'running')) return task
      const history = task.history.map((run) => {
        if (run.status !== 'running') return run
        return { ...run, status: 'failed' as const, completedAt: new Date().toISOString(), error: 'host stopped during execution' }
      })
      return {
        ...task,
        status: task.timing.repeat === 'once' ? 'ended' : task.status,
        history, updatedAt: new Date().toISOString(),
      }
    })
    if (recovered.some((task, index) => task !== tasks[index])) writeTasks(this.file, recovered)
  }

  private armScheduler(): void {
    if (this.stopped || this.runtimeCtx === undefined) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.dispatchDueTasks()
    }, this.pollIntervalMs)
  }

  private async dispatchDueTasks(): Promise<void> {
    if (this.stopped) return
    const now = Date.now()
    for (const task of readTasks(this.file)) {
      if (task.status !== 'active' || this.running.has(task.id)) continue
      if (task.timing.repeat === 'once' && task.history.length > 0) continue
      const scheduledRuns = task.history.filter(run => run.scheduledAt !== null)
      const previous = scheduledRuns.reduce((latest, run) => {
        const scheduledAt = run.scheduledAt
        return scheduledAt === null ? latest : Math.max(latest, Date.parse(scheduledAt))
      }, Date.parse(task.timing.at ?? ''))
      const occurrence = nextOccurrence(task, Number.isFinite(previous) ? previous - (scheduledRuns.length > 0 ? 0 : 1) : now)
      if (occurrence === undefined || occurrence > now) continue
      try {
        await this.execute(task.id, new Date(occurrence).toISOString())
      } catch (error: unknown) {
        this.ctx.logger.warn(`automation: scheduled task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.armScheduler()
  }

  private publish(): void {
    ;(this.ctx.emit as (name: string, value: AutomationCatalog) => void)(AUTOMATION_CHANGED, this.list())
  }

  private error(code: AutomationErrorCode, message: string): AutomationError {
    return new AutomationError(code, message)
  }
}

export default AutomationService

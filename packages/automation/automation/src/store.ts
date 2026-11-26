/** File-backed durable store for Host-wide automation tasks. */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gnkHomePath } from '@greeneek/gnk-home-paths'
import { AutomationError } from './error.ts'
import type { AutomationTask } from './types.ts'

/**
 * Default location of the automation task file.
 * @returns the fully-qualified path under the Greeneek home directory.
 */
export function defaultAutomationFile(): string {
  return join(gnkHomePath(), 'automation', 'tasks.json')
}

/**
 * Read all tasks; a missing file is an empty catalog.
 * @param file - task file to read.
 * @returns the tasks in the file, or an empty list when absent or invalid.
 */
export function readTasks(file: string): AutomationTask[] {
  if (!existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTask).map(task => ({ ...task, history: task.history ?? [] }))
  } catch (error) {
    throw new AutomationError('AUTOMATION_IO', `could not read automation tasks: ${String(error)}`)
  }
}

/**
 * Atomically replace all tasks.
 * @param file - task file to write.
 * @param tasks - full replacement task catalog.
 */
export function writeTasks(file: string, tasks: readonly AutomationTask[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(tasks, null, 2), { mode: 0o600 })
    renameSync(temp, file)
  } catch (error) {
    throw new AutomationError('AUTOMATION_IO', `could not write automation tasks: ${String(error)}`)
  }
}

/** Narrow an untrusted parsed value to one task. */
type PersistedTask = AutomationTask | (Omit<AutomationTask, 'history'> & { readonly history?: AutomationTask['history'] })

function isTask(value: unknown): value is PersistedTask {
  if (typeof value !== 'object' || value === null) return false
  const task = value as Record<string, unknown>
  const timing = task.timing
  const target = task.target
  return typeof task.id === 'string'
    && typeof task.title === 'string'
    && typeof task.prompt === 'string'
    && (task.status === 'active' || task.status === 'paused' || task.status === 'ended')
    && typeof task.createdAt === 'string'
    && typeof task.updatedAt === 'string'
    && (task.lastRunAt === null || typeof task.lastRunAt === 'string')
    && typeof timing === 'object' && timing !== null
    && (timing as Record<string, unknown>).repeat !== undefined
    && ['once', 'hourly', 'daily', 'weekly'].includes(String((timing as Record<string, unknown>).repeat))
    && ((timing as Record<string, unknown>).at === null || typeof (timing as Record<string, unknown>).at === 'string')
    && typeof (timing as Record<string, unknown>).timeZone === 'string'
    && isTimeZone((timing as Record<string, unknown>).timeZone as string)
    && typeof target === 'object' && target !== null
    && ((target as Record<string, unknown>).kind === 'new_once' || (target as Record<string, unknown>).kind === 'session')
    && ((target as Record<string, unknown>).sessionId === null || typeof (target as Record<string, unknown>).sessionId === 'string')
    && ((target as Record<string, unknown>).cwd === null || typeof (target as Record<string, unknown>).cwd === 'string')
    && (task.history === undefined || (Array.isArray(task.history) && task.history.every(isRun)))
}

function isRun(value: unknown): value is AutomationTask['history'][number] {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Record<string, unknown>
  return typeof run.id === 'string'
    && (run.scheduledAt === null || typeof run.scheduledAt === 'string')
    && (run.status === 'running' || run.status === 'succeeded' || run.status === 'failed')
    && typeof run.startedAt === 'string'
    && (run.completedAt === null || typeof run.completedAt === 'string')
    && typeof run.sessionId === 'string'
    && (run.result === null || typeof run.result === 'string')
    && (run.error === null || typeof run.error === 'string')
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

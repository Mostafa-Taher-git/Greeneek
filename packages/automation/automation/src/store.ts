/** File-backed durable store for Host-wide automation tasks. */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gnkHomePath } from '@greeneek/gnk-home-paths'
import { AutomationError } from './error.ts'
import type { AutomationTask } from './types.ts'

/** Default location of the automation task file. */
export function defaultAutomationFile(): string {
  return join(gnkHomePath(), 'automation', 'tasks.json')
}

/** Read all tasks; a missing file is an empty catalog. */
export function readTasks(file: string): AutomationTask[] {
  if (!existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTask)
  } catch (error) {
    throw new AutomationError('AUTOMATION_IO', `could not read automation tasks: ${String(error)}`)
  }
}

/** Atomically replace all tasks. */
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
function isTask(value: unknown): value is AutomationTask {
  if (typeof value !== 'object' || value === null) return false
  const task = value as Record<string, unknown>
  return typeof task.id === 'string'
    && typeof task.title === 'string'
    && typeof task.prompt === 'string'
    && (task.status === 'active' || task.status === 'paused' || task.status === 'ended')
    && typeof task.createdAt === 'string'
    && typeof task.updatedAt === 'string'
}

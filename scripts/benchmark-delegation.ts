/**
 * Delegation benchmark scaffold: fixed tasks, a fixed evaluation contract,
 * and a JSON report over supplied runs. The scaffold never invents a run or a
 * superiority claim: without complete sequential and Maestro coverage the
 * verdict is null and the report says so.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** Report schema version emitted by this scaffold. */
export const DELEGATION_BENCHMARK_VERSION = 1

/** One deterministic evaluation of a produced workspace or final answer. */
export type DelegationEvaluation =
  | { readonly kind: 'file-exists'; readonly path: string }
  | { readonly kind: 'file-contains'; readonly path: string; readonly text: string }
  | { readonly kind: 'answer-contains'; readonly text: string }

/** One fixed benchmark task. */
export interface DelegationTask {
  readonly id: string
  readonly description: string
  readonly prompt: string
  readonly evaluation: DelegationEvaluation
}

/** One supplied run; the scaffold does not execute tasks itself. */
export interface DelegationRun {
  readonly taskId: string
  readonly mode: 'sequential' | 'maestro'
  /** Wall-clock milliseconds for the whole task. */
  readonly wallTimeMs: number
  /** Provider-reported input tokens. */
  readonly inputTokens: number
  /** Provider-reported output tokens. */
  readonly outputTokens: number
  /** Known cost in USD; absent when the run's pricing is unknown. */
  readonly costUsd?: number
  readonly passed: boolean
}

/** Per-mode aggregation; null rates mean no run covered that mode. */
export interface DelegationModeSummary {
  readonly runs: number
  readonly passed: number
  readonly passRate: number | null
  readonly wallTimeMs: number
  readonly tokens: number
  readonly costUsd: number | null
}

/** Complete JSON report emitted by the scaffold. */
export interface DelegationBenchmarkReport {
  readonly schemaVersion: 1
  readonly tasks: readonly DelegationTask[]
  readonly runs: readonly DelegationRun[]
  readonly coverage: {
    readonly tasks: number
    readonly sequentialTasks: number
    readonly maestroTasks: number
    readonly complete: boolean
  }
  readonly summary: {
    readonly sequential: DelegationModeSummary
    readonly maestro: DelegationModeSummary
  }
  /** Present only when every task has both modes; otherwise null. */
  readonly verdict: 'sequential' | 'maestro' | 'tie' | null
  readonly note: string
}

/**
 * Parse the fixed task document at the file boundary.
 * @param value - decoded JSON value from the task file.
 * @returns validated, frozen tasks.
 */
export function parseDelegationTasks(value: unknown): readonly DelegationTask[] {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1) {
    throw new Error('delegation tasks must be an object with version 1')
  }
  if (!('tasks' in value) || !Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new Error('delegation tasks must contain a non-empty tasks array')
  }
  const ids = new Set<string>()
  return value.tasks.map((entry: unknown, index) => {
    const task = parseTask(entry, index)
    if (ids.has(task.id)) throw new Error(`duplicate delegation task id ${JSON.stringify(task.id)}`)
    ids.add(task.id)
    return task
  })
}

/** Validate one task entry. */
function parseTask(value: unknown, index: number): DelegationTask {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`delegation task ${String(index)} must be an object`)
  }
  const record = value as Record<string, unknown>
  const id = requiredText(record.id, `delegation task ${String(index)} id`)
  const description = requiredText(record.description, `delegation task "${id}" description`)
  const prompt = requiredText(record.prompt, `delegation task "${id}" prompt`)
  return Object.freeze({
    id,
    description,
    prompt,
    evaluation: parseEvaluation(record.evaluation, id),
  })
}

/** Validate one evaluation rule. */
function parseEvaluation(value: unknown, taskId: string): DelegationEvaluation {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`delegation task "${taskId}" evaluation must be an object`)
  }
  const record = value as Record<string, unknown>
  switch (record.kind) {
    case 'file-exists':
      return Object.freeze({ kind: 'file-exists', path: requiredText(record.path, `delegation task "${taskId}" evaluation path`) })
    case 'file-contains':
      return Object.freeze({
        kind: 'file-contains',
        path: requiredText(record.path, `delegation task "${taskId}" evaluation path`),
        text: requiredText(record.text, `delegation task "${taskId}" evaluation text`),
      })
    case 'answer-contains':
      return Object.freeze({
        kind: 'answer-contains',
        text: requiredText(record.text, `delegation task "${taskId}" evaluation text`),
      })
    default:
      throw new Error(`delegation task "${taskId}" evaluation kind is invalid`)
  }
}

/**
 * Parse supplied runs at the file boundary.
 * @param value - decoded JSON value from a results file.
 * @param tasks - fixed tasks the runs must reference.
 * @returns validated, frozen runs.
 */
export function parseDelegationRuns(value: unknown, tasks: readonly DelegationTask[]): readonly DelegationRun[] {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1) {
    throw new Error('delegation results must be an object with version 1')
  }
  if (!('runs' in value) || !Array.isArray(value.runs)) {
    throw new Error('delegation results must contain a runs array')
  }
  const known = new Set(tasks.map(task => task.id))
  const seen = new Set<string>()
  return value.runs.map((entry: unknown, index) => {
    const run = parseRun(entry, index)
    if (!known.has(run.taskId)) throw new Error(`delegation run references unknown task ${JSON.stringify(run.taskId)}`)
    const key = `${run.taskId}\0${run.mode}`
    if (seen.has(key)) {
      throw new Error(`delegation results repeat task ${JSON.stringify(run.taskId)} in ${run.mode} mode`)
    }
    seen.add(key)
    return run
  })
}

/** Validate one supplied run. */
function parseRun(value: unknown, index: number): DelegationRun {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`delegation run ${String(index)} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (record.mode !== 'sequential' && record.mode !== 'maestro') {
    throw new Error(`delegation run ${String(index)} mode must be sequential or maestro`)
  }
  if (typeof record.passed !== 'boolean') {
    throw new Error(`delegation run ${String(index)} passed must be a boolean`)
  }
  return Object.freeze({
    taskId: requiredText(record.taskId, `delegation run ${String(index)} taskId`),
    mode: record.mode,
    wallTimeMs: nonNegative(record.wallTimeMs, `delegation run ${String(index)} wallTimeMs`),
    inputTokens: nonNegativeInteger(record.inputTokens, `delegation run ${String(index)} inputTokens`),
    outputTokens: nonNegativeInteger(record.outputTokens, `delegation run ${String(index)} outputTokens`),
    ...record.costUsd === undefined
      ? {}
      : { costUsd: nonNegative(record.costUsd, `delegation run ${String(index)} costUsd`) },
    passed: record.passed,
  })
}

/**
 * Aggregate supplied runs and decide a verdict only with complete coverage.
 * @param tasks - fixed task set.
 * @param runs - supplied sequential and Maestro runs.
 * @returns the JSON report; verdict stays null until every task has both modes.
 */
export function summarizeDelegation(
  tasks: readonly DelegationTask[],
  runs: readonly DelegationRun[],
): DelegationBenchmarkReport {
  const sequential = summarizeMode(runs.filter(run => run.mode === 'sequential'))
  const maestro = summarizeMode(runs.filter(run => run.mode === 'maestro'))
  const sequentialTasks = new Set(runs.filter(run => run.mode === 'sequential').map(run => run.taskId)).size
  const maestroTasks = new Set(runs.filter(run => run.mode === 'maestro').map(run => run.taskId)).size
  const complete = sequentialTasks === tasks.length && maestroTasks === tasks.length
    && sequential.runs === tasks.length && maestro.runs === tasks.length
  const verdict = complete ? verdictOf(sequential, maestro) : null
  return {
    schemaVersion: DELEGATION_BENCHMARK_VERSION,
    tasks,
    runs,
    coverage: { tasks: tasks.length, sequentialTasks, maestroTasks, complete },
    summary: { sequential, maestro },
    verdict,
    note: complete
      ? 'Every task has one sequential and one Maestro run; the verdict compares pass rate first, then wall time.'
      : 'No complete comparison exists yet. Supply one sequential and one Maestro run per fixed task before drawing a conclusion.',
  }
}

/** Aggregate one mode's runs. */
function summarizeMode(runs: readonly DelegationRun[]): DelegationModeSummary {
  const passed = runs.filter(run => run.passed).length
  return {
    runs: runs.length,
    passed,
    passRate: runs.length === 0 ? null : passed / runs.length,
    wallTimeMs: runs.reduce((total, run) => total + run.wallTimeMs, 0),
    tokens: runs.reduce((total, run) => total + run.inputTokens + run.outputTokens, 0),
    costUsd: runs.length > 0 && runs.every(run => run.costUsd !== undefined)
      ? runs.reduce((total, run) => total + (run.costUsd ?? 0), 0)
      : null,
  }
}

/** Compare two complete summaries; pass rate wins before wall time. */
function verdictOf(sequential: DelegationModeSummary, maestro: DelegationModeSummary): 'sequential' | 'maestro' | 'tie' {
  const sequentialRate = sequential.passRate ?? 0
  const maestroRate = maestro.passRate ?? 0
  if (sequentialRate !== maestroRate) return sequentialRate > maestroRate ? 'sequential' : 'maestro'
  if (sequential.wallTimeMs === maestro.wallTimeMs) return 'tie'
  return sequential.wallTimeMs < maestro.wallTimeMs ? 'sequential' : 'maestro'
}

/** Require one non-empty string field. */
function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

/** Require one finite non-negative number. */
function nonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`)
  }
  return value
}

/** Require one non-negative safe integer. */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value
}

/** Read, validate, and report one benchmark invocation. */
function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tasks: { type: 'string' },
      results: { type: 'string' },
    },
    allowPositionals: false,
  })
  const tasksPath = resolve(values.tasks ?? 'benchmarks/delegation/tasks.json')
  const tasks = parseDelegationTasks(JSON.parse(readFileSync(tasksPath, 'utf8')) as unknown)
  const runs = values.results === undefined
    ? []
    : parseDelegationRuns(JSON.parse(readFileSync(resolve(values.results), 'utf8')) as unknown, tasks)
  process.stdout.write(`${JSON.stringify(summarizeDelegation(tasks, runs), undefined, 2)}\n`)
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`benchmark-delegation: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

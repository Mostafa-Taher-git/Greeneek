/**
 * Structural assertions shared by the workflow specs.
 *
 * The CI workflow and the release workflows are held to the same contract:
 * every action is pinned to a full commit SHA with a version comment, and the
 * jobs are read through the same helpers. One implementation keeps both
 * specs reading the same way.
 * @module scripts/lib/workflow-assertions
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

/** The repository root the workflows are read from. */
const root = resolve(import.meta.dirname, '..', '..')

/** The action major version each pinned action must carry. */
export const CURRENT_ACTION_MAJORS: Record<string, string> = {
  'actions/checkout': 'v7',
  'actions/setup-node': 'v7',
  'pnpm/action-setup': 'v6',
  'actions/upload-artifact': 'v7',
  'actions/download-artifact': 'v8',
  'gitleaks/gitleaks-action': 'v3',
  'softprops/action-gh-release': 'v3',
}

/**
 * Whether one value is a mapping.
 * @param value - the value to test.
 * @returns true for a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Load one workflow file.
 * @param path - workflow file path relative to the repository root.
 * @returns the parsed workflow.
 */
export function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

/**
 * Every `uses:` line of one workflow, as raw file text. The pinned SHA check
 * reads this form because YAML strips a trailing `# vN` comment from the
 * parsed value while Dependabot and reviewers need the comment in the file.
 * @param path - workflow file path relative to the repository root.
 * @returns each `uses:` value as written, trimmed.
 */
export function rawActionUses(path: string): readonly string[] {
  return readFileSync(resolve(root, path), 'utf8').split('\n').flatMap((line) => {
    const match = line.match(/^\s*-?\s*uses:\s*(\S.*)$/)
    return match === null || match[1] === undefined ? [] : [match[1].trim()]
  })
}

/**
 * Check one `uses:` value against the pinned action major versions.
 * @param use - the `uses:` value as written.
 */
export function assertCurrentActionMajor(use: string): void {
  if (use.startsWith('./') || use.startsWith('docker://')) return
  const pin = use.match(/^(\S+)@([0-9a-f]{40})\s*#\s*(v\S+)$/)
  if (pin === null) {
    throw new Error(`"${use}" must pin a full commit SHA with a "# vN" version comment`)
  }
  const expected = CURRENT_ACTION_MAJORS[pin[1] ?? '']
  if (expected !== undefined && pin[3] !== expected) {
    throw new Error(`${pin[1]} must use ${expected}, found ${pin[3]}`)
  }
}

/**
 * Check every action of one workflow against the pinned major versions.
 * @param path - workflow file path relative to the repository root.
 */
export function assertWorkflowActionsPinned(path: string): void {
  for (const use of rawActionUses(path)) assertCurrentActionMajor(use)
}

/**
 * The jobs of one workflow.
 * @param workflow - the parsed workflow.
 * @returns the job mapping.
 */
export function workflowJobs(workflow: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(workflow.jobs)) throw new TypeError('workflow must define jobs')
  return workflow.jobs
}

/**
 * One named job of a workflow.
 * @param workflow - the parsed workflow.
 * @param name - the job name.
 * @returns the job mapping.
 */
export function jobNamed(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
  const job = workflowJobs(workflow)[name]
  if (!isRecord(job)) throw new TypeError(`workflow must define the ${name} job`)
  return job
}

/**
 * The steps of one named job.
 * @param workflow - the parsed workflow.
 * @param name - the job name.
 * @returns the step mappings.
 */
export function jobSteps(workflow: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const steps = jobNamed(workflow, name).steps
  if (!Array.isArray(steps)) throw new TypeError(`${name} must define steps`)
  return steps.map((step, index) => {
    if (!isRecord(step)) throw new TypeError(`${name} step ${index} must be a mapping`)
    return step
  })
}

/**
 * Every step of every job in one workflow.
 * @param workflow - the parsed workflow.
 * @returns the step mappings.
 */
export function allSteps(workflow: Record<string, unknown>): Record<string, unknown>[] {
  return Object.keys(workflowJobs(workflow)).flatMap((name) => {
    const job = workflowJobs(workflow)[name]
    return isRecord(job) && Array.isArray(job.steps) ? job.steps.filter(isRecord) : []
  })
}

/**
 * The `run:` text of one job.
 * @param job - the job mapping.
 * @returns the joined run text.
 */
export function runText(job: Record<string, unknown>): string {
  if (!Array.isArray(job.steps)) return ''
  return job.steps
    .filter(isRecord)
    .map(step => (typeof step.run === 'string' ? step.run : ''))
    .join('\n')
}

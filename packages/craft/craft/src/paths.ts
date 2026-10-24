/**
 * Workspace and job-root confinement.
 *
 * Read root = the session workspace. Write root = `<workspace>/out`. Every
 * artifact path an app reports is resolved against the write root and rejected
 * when it escapes, so a buggy or hostile app cannot write outside the job.
 * @module @greeneek/gnk-craft/paths
 */

import { isAbsolute, join, relative, resolve } from 'node:path'
import { CraftError } from './error.ts'
import type { CraftRoots } from './types.ts'

/** Name of the per-launch control-token file inside the job root. */
export const CONTROL_TOKEN_FILE = '.craft-control-token'

/**
 * Validate and normalize the session workspace root.
 * @param value - caller-supplied root.
 * @returns an absolute normalized path.
 */
export function resolveWorkspaceRoot(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CraftError('a Craft session requires a workspace root', 'CRAFT_ROOT_INVALID')
  }
  if (!isAbsolute(value)) {
    throw new CraftError(`Craft workspace root must be absolute: ${JSON.stringify(value)}`, 'CRAFT_ROOT_INVALID')
  }
  return resolve(value)
}

/**
 * Derive the confined roots for one job.
 * @param workspaceRoot - validated absolute workspace root.
 * @returns read = workspace, write = workspace/out.
 */
export function craftRoots(workspaceRoot: string): CraftRoots {
  const read = resolveWorkspaceRoot(workspaceRoot)
  return { read, write: join(read, 'out') }
}

/**
 * Path of the per-launch control-token file.
 * @param roots - confined job roots.
 * @returns `<write>/.craft-control-token`.
 */
export function controlTokenPath(roots: CraftRoots): string {
  return join(roots.write, CONTROL_TOKEN_FILE)
}

/**
 * Confine one app-reported artifact path to the job write root.
 * @param roots - confined job roots.
 * @param artifact - absolute or write-root-relative artifact path.
 * @returns the normalized absolute path inside the write root.
 */
export function confineArtifact(roots: CraftRoots, artifact: string): string {
  if (typeof artifact !== 'string' || artifact.trim().length === 0) {
    throw new CraftError('a Craft artifact path must be a non-empty string', 'CRAFT_ROOT_INVALID')
  }
  const writeRoot = resolve(roots.write)
  const candidate = resolve(writeRoot, artifact)
  const inside = relative(writeRoot, candidate)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new CraftError(
      `Craft artifact ${JSON.stringify(artifact)} escapes the job output root`,
      'CRAFT_ROOT_INVALID',
    )
  }
  return candidate
}

/** Shared serialization and git boundaries for lane lifecycle and integration. */

import { execFile } from 'node:child_process'
import type { SessionId } from '@greeneek/gnk-session/types'
import { errorMessage, TeamError } from './error.ts'
import type { WorktreeGitRunner } from './worktrees.ts'

/** Upper bound on the git diagnostic carried by a lane refusal. */
const MAX_DIAGNOSTIC_CHARS = 2_048

/**
 * Run one lane git invocation and map any failure to the shared lane error.
 * @param runGit - configured process boundary.
 * @param argv - exact git arguments.
 * @param signal - caller cancellation.
 * @param cwd - repository or checkout directory.
 * @returns captured stdout.
 */
export async function runLaneGit(
  runGit: WorktreeGitRunner,
  argv: readonly string[],
  signal: AbortSignal,
  cwd: string,
): Promise<string> {
  try {
    return await runGit({ argv, cwd, signal })
  } catch (error: unknown) {
    throw new TeamError(
      `git ${argv.join(' ')} failed in ${cwd}: ${errorMessage(error)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
      'TEAM_LANE_GIT_FAILED',
      { cause: error },
    )
  }
}

/**
 * Run one lane mutation after every earlier mutation for the same Lead.
 * @param queues - per-Lead queue tails.
 * @param sessionId - serialization key.
 * @param operation - admitted mutation.
 * @returns the operation result.
 */
export async function enqueueLane<T>(
  queues: Map<string, Promise<unknown>>,
  sessionId: SessionId,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  const tracked = next.catch(() => undefined)
  queues.set(sessionId, tracked)
  try {
    return await next
  } finally {
    if (queues.get(sessionId) === tracked) queues.delete(sessionId)
  }
}

/** Host git boundary with bounded captured output and optional locks. */
export const hostLaneGit: WorktreeGitRunner = async ({ argv, cwd, signal }) => await new Promise<string>((settle, fail) => {
  execFile('git', [...argv], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    signal,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  }, (error, stdout, stderr) => {
    if (error === null) {
      settle(stdout)
      return
    }
    fail(new Error(`${error.message}: ${stderr.trim()}`.slice(0, MAX_DIAGNOSTIC_CHARS)))
  })
})

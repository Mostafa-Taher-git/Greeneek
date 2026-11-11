/**
 * Read-only git facts for one project directory.
 *
 * The adapter answers what a project menu shows: the checked-out branch, the
 * base branch the work is compared against, and the size of the change set.
 * Every command is read-only and runs without a shell.
 * @module @greeneek/gnk-native-command/git-facts
 */

import { runNativeCommand, type NativeCommandRunner } from './runner.ts'

/** Git facts about one project directory. */
export interface GitFacts {
  /** True when the directory is inside a git work tree. */
  readonly isRepository: boolean
  /** Checked-out branch, absent on a detached HEAD. */
  readonly branch?: string
  /** Branch the change set is compared against, absent when unknown. */
  readonly baseBranch?: string
  /** Files that differ from the base branch. */
  readonly changedFiles: number
  /** Lines added against the base branch. */
  readonly insertions: number
  /** Lines removed against the base branch. */
  readonly deletions: number
}

/** Injectable seam for deterministic tests. */
export interface GitFactsInternals {
  /** Command runner; the default runs the host `git` executable. */
  readonly run?: NativeCommandRunner
}

/** Upper bound on retained git output; git prints one line per changed file. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/**
 * Run one read-only git command in a project directory.
 *
 * The directory is selected with git's own `-C` flag, so no shell and no
 * working-directory change is involved.
 * @param args - git subcommand and its arguments.
 * @param cwd - the project directory.
 * @param signal - caller lifetime; abort terminates the child.
 * @param run - command runner seam.
 * @returns trimmed stdout, or undefined when git failed (not a repository, no git).
 */
async function gitOutput(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  run: NativeCommandRunner,
): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], signal)
    return stdout.trim()
  } catch {
    // A missing git, a missing repository, or a failing command all mean the
    // same thing for this adapter: no facts to report.
    return undefined
  }
}

/**
 * Parse `git diff --numstat` output into line counts.
 * @param numstat - the raw numstat output.
 * @returns the number of changed files, added lines, and removed lines.
 */
function parseNumstat(numstat: string): { files: number; insertions: number; deletions: number } {
  let files = 0
  let insertions = 0
  let deletions = 0
  for (const line of numstat.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const [added = '0', removed = '0'] = trimmed.split('\t')
    files += 1
    // A binary file reports `-` for both counts.
    insertions += added === '-' ? 0 : Number.parseInt(added, 10) || 0
    deletions += removed === '-' ? 0 : Number.parseInt(removed, 10) || 0
  }
  return { files, insertions, deletions }
}

/**
 * Read the git facts of one project directory.
 *
 * The adapter never writes: it reports the branch, the base branch, and the
 * size of the change set against that base.
 * @param path - absolute path of the project directory.
 * @param signal - caller lifetime; abort terminates the child.
 * @param internals - command runner seam.
 * @returns the facts, or `isRepository: false` when the path is not a repository.
 */
export async function gitFacts(
  path: string,
  signal: AbortSignal,
  internals: GitFactsInternals = {},
): Promise<GitFacts> {
  const run = internals.run ?? runNativeCommand
  const inside = await gitOutput(['rev-parse', '--is-inside-work-tree'], path, signal, run)
  if (inside !== 'true') return { isRepository: false, changedFiles: 0, insertions: 0, deletions: 0 }

  const branch = await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], path, signal, run)
  const remoteHead = await gitOutput(
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    path,
    signal,
    run,
  )
  const base = remoteHead === undefined
    ? await gitOutput(['rev-parse', '--abbrev-ref', 'origin/HEAD'], path, signal, run)
    : remoteHead.replace(/^origin\//, '')
  // An empty answer means git could not name the branch.
  const baseBranch = base === undefined || base === '' ? undefined : base
  const currentBranch = branch === undefined || branch === '' || branch === 'HEAD'
    ? undefined
    : branch

  const numstat = await gitOutput(
    baseBranch === undefined ? ['diff', '--numstat', 'HEAD'] : ['diff', '--numstat', baseBranch],
    path,
    signal,
    run,
  )
  const counts = numstat === undefined
    ? { files: 0, insertions: 0, deletions: 0 }
    : parseNumstat(numstat.slice(0, MAX_OUTPUT_BYTES))

  return {
    isRepository: true,
    ...(currentBranch === undefined ? {} : { branch: currentBranch }),
    ...(baseBranch === undefined ? {} : { baseBranch }),
    changedFiles: counts.files,
    insertions: counts.insertions,
    deletions: counts.deletions,
  }
}

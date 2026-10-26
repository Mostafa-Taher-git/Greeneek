/**
 * Lane checkout isolation: one git worktree per writable lane below
 * `<gnkHome>/worktrees/<sessionId>/<lane>/`, created from the repository's
 * current `HEAD`, reported with that base revision, and removed together with
 * its lane branch when the lane ends.
 * @module @greeneek/gnk-agent-team/worktrees
 */

import { execFile } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { mkdir, realpath, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { Branded } from '@greeneek/gnk-brand'
import type { SessionId } from '@greeneek/gnk-session/types'
import { errorMessage, TeamError } from './error.ts'

/** Stable failure raised by lane worktree management. */
export type WorktreeErrorCode =
  | 'WORKTREE_PATH_ESCAPE'
  | 'WORKTREE_EXISTS'
  | 'WORKTREE_NOT_A_REPOSITORY'
  | 'WORKTREE_NO_BASE_REVISION'
  | 'WORKTREE_GIT_FAILED'
  | 'WORKTREE_REMOVE_INCOMPLETE'

/** Lane worktree failure carrying the machine-routable class of the refusal. */
export class WorktreeError extends TeamError {
  declare readonly code: WorktreeErrorCode

  /**
   * @param message - diagnostic naming the lane, checkout path, or branch involved.
   * @param code - failure class; route on it, never on the message text.
   * @param options - optional cause of the git or filesystem failure.
   */
  constructor(message: string, code: WorktreeErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'WorktreeError'
  }
}

/** Opaque identity of one git commit used as a lane base. */
export type GitRevision = Branded<'GitRevision'>

/**
 * Brand one commit id resolved by git.
 * @param revision - commit id printed by `git rev-parse HEAD`.
 * @returns the same commit id branded as a lane base revision.
 */
export function GitRevision(revision: string): GitRevision {
  return revision as GitRevision
}

/** One lane identity and the caller's cancellation. */
export interface LaneWorktreeRequest {
  /** Session that owns the lane. */
  readonly sessionId: SessionId
  /** Lane name; also the checkout directory name. */
  readonly lane: string
  /** Cancels directory work and the git child process. */
  readonly signal: AbortSignal
}

/** Session whose lanes are listed, plus cancellation. */
export interface LaneWorktreeListRequest {
  /** Session that owns the lanes. */
  readonly sessionId: SessionId
  /** Cancels directory reads and the git child processes. */
  readonly signal: AbortSignal
}

/** One live lane checkout. */
export interface LaneWorktree {
  /** Session that owns the lane. */
  readonly sessionId: SessionId
  /** Lane name; one path segment below the Session's worktree root. */
  readonly lane: string
  /** Canonical absolute checkout path, `<gnkHome>/worktrees/<sessionId>/<lane>`. */
  readonly path: string
  /** Lane branch, `gnk-lane/<sessionId>/<lane>`, removed with the checkout. */
  readonly branch: string
  /** Recorded base commit; the checkout's `HEAD` while lane work stays uncommitted. */
  readonly baseRevision: GitRevision
}

/** Repository and harness home that own one manager's lane checkouts. */
export interface WorktreeManagerOptions {
  /** Repository root whose `HEAD` bases every lane checkout. */
  readonly repositoryRoot: string
  /** Harness home; lane checkouts live below its `worktrees` directory. */
  readonly gnkHome: string
  /**
   * Git process boundary; omitted runs the host `git` executable.
   * @see WorktreeGitRunner
   */
  readonly runGit?: WorktreeGitRunner
}

/** One git invocation handed to the process boundary. */
export interface WorktreeGitInvocation {
  /** Exact git arguments; `argv[0]` is a git subcommand because the executable is fixed. */
  readonly argv: readonly string[]
  /** Working directory: the repository root or one lane checkout. */
  readonly cwd: string
  /** Caller cancellation; a runner terminates its child when this aborts. */
  readonly signal: AbortSignal
}

/**
 * Git process boundary. The default runs the host `git` with `execFile`; a
 * composition that owns the `ctx.subprocess` capability passes a runner that
 * spawns git in that execution world and policy instead. A runner resolves
 * with stdout and rejects only when the command fails or is cancelled.
 */
export type WorktreeGitRunner = (invocation: WorktreeGitInvocation) => Promise<string>

/** Branch-name prefix owned by this module; removal never deletes another ref. */
const BRANCH_PREFIX = 'gnk-lane'

/** Upper bound on bytes retained from one git invocation. */
const MAX_GIT_OUTPUT_BYTES = 1_048_576

/** Upper bound on the git diagnostic carried by a WorktreeError message. */
const MAX_DIAGNOSTIC_CHARS = 1_024

/**
 * One Session id or lane name: letters, digits, `'.'`, `'_'`, `'-'`, starting
 * with a letter or digit, at most 64 characters. A leading dot would hide the
 * directory, and `'..'`, a trailing `'.'`, or a trailing `'.lock'` would make
 * the lane branch an invalid git ref.
 */
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

/**
 * Lane checkouts over one repository, rooted below one harness home.
 *
 * Every git invocation runs through the configured {@link WorktreeGitRunner} —
 * the host `git` by default — with an argv array, the caller's `AbortSignal`,
 * and a bounded stdout buffer; no shell string is ever built. The manager
 * never checks out, resets, cleans, or deletes a ref outside the lane branch
 * it created, so the repository's primary checkout is untouched. A cancelled
 * invocation rejects with `WORKTREE_GIT_FAILED` whose cause is the abort; the
 * caller that owns the signal classifies the cancellation.
 */
export class WorktreeManager {
  private readonly repositoryRoot: string
  private readonly worktreesRoot: string
  private readonly runGit: WorktreeGitRunner

  /**
   * Bind lane checkouts to one repository and one harness home.
   * @param options - repository root, harness home, and git process boundary.
   */
  constructor(options: WorktreeManagerOptions) {
    this.repositoryRoot = resolve(options.repositoryRoot)
    this.worktreesRoot = join(resolve(options.gnkHome), 'worktrees')
    this.runGit = options.runGit ?? execGit
  }

  /**
   * Create one lane checkout at `<gnkHome>/worktrees/<sessionId>/<lane>` from
   * the repository's current `HEAD`.
   * @param request - Session, lane, and cancellation.
   * @returns the checkout path, its branch, and the recorded base revision.
   */
  async create(request: LaneWorktreeRequest): Promise<LaneWorktree> {
    const { sessionId, lane, signal } = request
    signal.throwIfAborted()
    const name = laneSegment(lane, 'lane')
    const session = laneSegment(sessionId, 'session id')
    await this.assertRepository(signal)
    const baseRevision = await this.readBaseRevision(name, signal)
    const sessionRoot = await this.createSessionRoot(session)
    const path = join(sessionRoot, name)
    const branch = laneBranch(session, name)
    const existing = lstatSync(path, { throwIfNoEntry: false })
    if (existing !== undefined) {
      throw new WorktreeError(`lane "${name}" already has a checkout at ${path}`, 'WORKTREE_EXISTS')
    }
    if (await this.branchExists(branch, signal)) {
      throw new WorktreeError(`lane "${name}" already has branch ${branch}`, 'WORKTREE_EXISTS')
    }
    await this.git(['worktree', 'add', '-b', branch, path, baseRevision], signal)
    return Object.freeze({ sessionId, lane: name, path, branch, baseRevision })
  }

  /**
   * Report the live lane checkouts of one Session with their base revisions.
   * A checkout counts as live when git registers it and its directory exists.
   * @param request - Session and cancellation.
   * @returns live lanes ordered by lane name.
   */
  async list(request: LaneWorktreeListRequest): Promise<readonly LaneWorktree[]> {
    const { sessionId, signal } = request
    signal.throwIfAborted()
    const session = laneSegment(sessionId, 'session id')
    await this.assertRepository(signal)
    const sessionRoot = await this.findSessionRoot(session)
    if (sessionRoot === undefined) return []
    const output = await this.git(['worktree', 'list', '--porcelain'], signal)
    const lanes: LaneWorktree[] = []
    for (const listed of listedWorktrees(output)) {
      const stats = lstatSync(listed, { throwIfNoEntry: false })
      if (stats === undefined || !stats.isDirectory()) continue
      if (await realpath(dirname(listed)) !== sessionRoot) continue
      const lane = basename(listed)
      const path = join(sessionRoot, lane)
      const baseRevision = await this.readHead(path, signal)
      lanes.push(Object.freeze({
        sessionId,
        lane,
        path,
        branch: laneBranch(session, lane),
        baseRevision,
      }))
    }
    return lanes.sort((left, right) => left.lane.localeCompare(right.lane))
  }

  /**
   * Remove one lane checkout, its git registration, and its branch. Removing a
   * lane that is already gone succeeds; a checkout or branch that survives is
   * reported with `WORKTREE_REMOVE_INCOMPLETE` naming what remains. Pruning
   * drops git's record only for checkout directories that are already gone, so
   * another live worktree is never removed.
   * @param request - Session, lane, and cancellation.
   */
  async remove(request: LaneWorktreeRequest): Promise<void> {
    const { sessionId, lane, signal } = request
    signal.throwIfAborted()
    const name = laneSegment(lane, 'lane')
    const session = laneSegment(sessionId, 'session id')
    await this.assertRepository(signal)
    const sessionRoot = await this.findSessionRoot(session)
    const path = sessionRoot === undefined ? undefined : join(sessionRoot, name)
    const branch = laneBranch(session, name)
    const attempts: Array<() => Promise<void>> = []
    if (path !== undefined) {
      attempts.push(async () => {
        await removeLanePath(path)
      })
    }
    attempts.push(async () => {
      await this.git(['worktree', 'prune'], signal)
    })
    attempts.push(async () => {
      if (await this.branchExists(branch, signal)) await this.git(['branch', '-D', branch], signal)
    })
    const failures: unknown[] = []
    for (const attempt of attempts) {
      try {
        await attempt()
      } catch (error) {
        failures.push(error)
      }
    }
    const remaining: string[] = []
    if (path !== undefined && lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
      remaining.push(`checkout ${path}`)
    }
    if (await this.branchExists(branch, signal)) remaining.push(`branch ${branch}`)
    if (remaining.length > 0) {
      throw new WorktreeError(
        `lane "${name}" removal left ${remaining.join(', ')}: ${failures.map(errorMessage).join('; ')}`,
        'WORKTREE_REMOVE_INCOMPLETE',
        { cause: failures[0] },
      )
    }
  }

  /**
   * Run one git command in the repository root or one lane checkout.
   * @param argv - exact git arguments; never shell-interpreted.
   * @param signal - caller cancellation for the child process.
   * @param cwd - working directory, the repository root unless given.
   * @returns captured stdout.
   */
  private async git(argv: readonly string[], signal: AbortSignal, cwd: string = this.repositoryRoot): Promise<string> {
    try {
      return await this.runGit({ argv, cwd, signal })
    } catch (error) {
      throw new WorktreeError(
        `git ${argv.join(' ')} failed in ${cwd}: ${errorMessage(error)}`,
        'WORKTREE_GIT_FAILED',
        { cause: error },
      )
    }
  }

  /** Refuse a root that is not a git work tree before any directory work. */
  private async assertRepository(signal: AbortSignal): Promise<void> {
    try {
      await this.git(['rev-parse', '--git-dir'], signal)
    } catch (error) {
      throw new WorktreeError(
        `repository root ${this.repositoryRoot} is not a git repository: ${errorMessage(error)}`,
        'WORKTREE_NOT_A_REPOSITORY',
        { cause: error },
      )
    }
  }

  /** Resolve the repository's current commit as the lane base. */
  private async readBaseRevision(lane: string, signal: AbortSignal): Promise<GitRevision> {
    try {
      return GitRevision((await this.git(['rev-parse', 'HEAD'], signal)).trim())
    } catch (error) {
      throw new WorktreeError(
        `repository ${this.repositoryRoot} has no committed HEAD to base lane "${lane}" on: ${errorMessage(error)}`,
        'WORKTREE_NO_BASE_REVISION',
        { cause: error },
      )
    }
  }

  /** Read one checkout's current commit, which members never advance. */
  private async readHead(path: string, signal: AbortSignal): Promise<GitRevision> {
    return GitRevision((await this.git(['rev-parse', 'HEAD'], signal, path)).trim())
  }

  /** Whether one lane branch exists; an absent ref is the expected failure. */
  private async branchExists(branch: string, signal: AbortSignal): Promise<boolean> {
    try {
      await this.git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], signal)
      return true
    } catch {
      // `--quiet` makes an absent ref the ordinary failure; creation and removal
      // run git again, so a repository-level failure surfaces there.
      return false
    }
  }

  /** Create the Session worktree root and return its canonical path. */
  private async createSessionRoot(session: string): Promise<string> {
    const sessionRoot = join(this.worktreesRoot, session)
    await mkdir(sessionRoot, { recursive: true })
    return await this.assertLaneRoot(sessionRoot, session)
  }

  /** Canonical Session worktree root, or undefined when the Session has none. */
  private async findSessionRoot(session: string): Promise<string | undefined> {
    const sessionRoot = join(this.worktreesRoot, session)
    const stats = lstatSync(sessionRoot, { throwIfNoEntry: false })
    if (stats === undefined) return undefined
    return await this.assertLaneRoot(sessionRoot, session)
  }

  /** Refuse a Session root that resolves outside the worktrees directory. */
  private async assertLaneRoot(sessionRoot: string, session: string): Promise<string> {
    const [root, resolved] = await Promise.all([realpath(this.worktreesRoot), realpath(sessionRoot)])
    if (resolved !== join(root, session)) {
      throw new WorktreeError(
        `lane root ${sessionRoot} resolves to ${resolved}, outside ${root}`,
        'WORKTREE_PATH_ESCAPE',
      )
    }
    return resolved
  }
}

/**
 * Validate one Session id or lane name as a single path segment below the
 * Session worktree root.
 * @param value - candidate id or lane name.
 * @param field - diagnostic name of the rejected value.
 * @returns the value unchanged.
 */
function laneSegment(value: string, field: string): string {
  if (!PATH_SEGMENT.test(value) || value.includes('..') || value.endsWith('.') || value.endsWith('.lock')) {
    throw new WorktreeError(
      `${field} ${JSON.stringify(value)} must be one path segment of letters, digits, '.', '_', or '-', at most 64 characters,`
      + " without '..', a trailing '.', or a '.lock' suffix",
      'WORKTREE_PATH_ESCAPE',
    )
  }
  return value
}

/**
 * Branch name owned by one lane; the reserved prefix scopes every deletion.
 * @param session - validated Session id.
 * @param lane - validated lane name.
 * @returns the lane branch name.
 */
function laneBranch(session: string, lane: string): string {
  return `${BRANCH_PREFIX}/${session}/${lane}`
}

/**
 * Extract registered worktree paths from `git worktree list --porcelain`.
 * Only the path line starts with `worktree `; attribute lines follow it.
 * @param output - complete porcelain output.
 * @returns one absolute path per registered worktree, in git's order.
 */
function listedWorktrees(output: string): string[] {
  const paths: string[] = []
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(line.slice('worktree '.length))
  }
  return paths
}

/**
 * Delete one lane checkout without following a link planted at its own path.
 * @param path - canonical checkout path.
 */
async function removeLanePath(path: string): Promise<void> {
  const stats = lstatSync(path, { throwIfNoEntry: false })
  if (stats === undefined) return
  if (stats.isSymbolicLink()) {
    await unlink(path)
    return
  }
  await rm(path, { recursive: true, force: true, maxRetries: 3 })
}

/**
 * Run git with an argv array, caller cancellation, and bounded captured output.
 * @param invocation - subcommand argv, working directory, and caller cancellation.
 * @returns captured stdout.
 */
const execGit: WorktreeGitRunner = ({ argv, cwd, signal }) => new Promise((resolveRun, rejectRun) => {
  execFile('git', [...argv], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    signal,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  }, (error, stdout, stderr) => {
    if (error === null) {
      resolveRun(stdout)
      return
    }
    rejectRun(new Error(`${error.message}: ${stderr.trim()}`.slice(0, MAX_DIAGNOSTIC_CHARS)))
  })
})

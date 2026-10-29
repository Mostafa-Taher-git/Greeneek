/**
 * Durable lane lifecycle: one isolated checkout per writable teammate, its
 * checkpointed patch, and its terminal merge or discard. Records live below
 * `<gnkHome>/lanes/<sessionId>/`, never inside a candidate checkout, so a
 * crash leaves enough evidence to finish or roll back the recorded transaction
 * without touching an unrecorded path.
 * @module @greeneek/gnk-agent-team/lane-lifecycle
 */

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Branded } from '@greeneek/gnk-brand'
import type { SessionId } from '@greeneek/gnk-session/types'
import { z } from 'zod'
import { errorMessage, TeamError } from './error.ts'
import { assertDisjointLaneScopes } from './lane-policy.ts'
import type { ActiveLaneScope } from './lane-policy.ts'
import { writeScope } from './validation.ts'
import { GitRevision, laneBranch, laneSegment, WorktreeManager } from './worktrees.ts'
import type { GitRevision as GitRevisionType, LaneWorktree, WorktreeGitRunner } from './worktrees.ts'

/** Stable identity of one lane below one Lead Session. */
export type LaneName = Branded<'LaneName'>

/**
 * Brand one validated teammate name as a lane identity.
 * @param name - lower-kebab-case teammate name.
 * @returns the same name branded as a lane.
 */
export function LaneName(name: string): LaneName {
  return name as LaneName
}

/** Durable lane transaction stage. */
export type LaneStage =
  | 'preparing'
  | 'ready'
  | 'closing'
  | 'merged'
  | 'discarded'
  | 'quarantined'
  | 'failed'

/** One checkpointed patch and the reviewed bytes it covers. */
export interface LaneCheckpoint {
  /** Lower-case SHA-256 of the exact patch bytes. */
  readonly hash: string
  /** Absolute patch file below the lane record directory. */
  readonly path: string
  /** Patch byte length. */
  readonly bytes: number
  /** Epoch milliseconds when the patch was produced. */
  readonly at: number
}

/** Whole durable lane record, rewritten atomically on every transition. */
export interface LaneRecord {
  /** Record format version; one version is written and read. */
  readonly version: 1
  /** Lead Session that owns the lane. */
  readonly sessionId: SessionId
  /** Stable lane identity, also the checkout directory and branch segment. */
  readonly lane: LaneName
  /** Teammate Session that runs in the lane. */
  readonly childSessionId: SessionId
  /** Canonical repository root the checkout was based on. */
  readonly repositoryRoot: string
  /** Canonical checkout path. */
  readonly path: string
  /** Lane branch below the reserved `gnk-lane/` prefix. */
  readonly branch: string
  /** Commit the lane checkout was created from. */
  readonly baseRevision: GitRevisionType
  /** Workspace-relative prefixes the lane may change. */
  readonly writeScopes: readonly string[]
  /** Current transaction stage. */
  readonly stage: LaneStage
  /** Epoch milliseconds when the record was first written. */
  readonly createdAt: number
  /** Latest checkpoint; absent until the lane is checkpointed. */
  readonly checkpoint?: LaneCheckpoint
  /** Terminal refusal or cleanup diagnostic; present on failed and quarantined lanes. */
  readonly diagnostic?: string
}

/** One isolated lane creation request. */
export interface LaneCreateRequest {
  /** Lead Session owning the lane. */
  readonly sessionId: SessionId
  /** Validated teammate name. */
  readonly lane: string
  /** Teammate Session that will run in the checkout. */
  readonly childSessionId: SessionId
  /** Lead checkout used to discover the canonical repository root. */
  readonly cwd: string | undefined
  /** Normalized workspace-relative write prefixes. */
  readonly writeScopes: readonly string[]
  /** Cancels repository discovery and checkout creation. */
  readonly signal: AbortSignal
}

/** Options binding lane records to one harness home. */
export interface LaneLifecycleManagerOptions {
  /** Harness home; records live below its `lanes` directory. */
  readonly gnkHome: string
  /** Upper bound on one checkpointed patch. */
  readonly maxPatchBytes?: number
  /**
   * Git process boundary; omitted runs the host `git`.
   * @see WorktreeGitRunner
   */
  readonly runGit?: WorktreeGitRunner
}

/** Default checkpoint ceiling; a larger patch is refused before it is stored. */
const DEFAULT_MAX_PATCH_BYTES = 16 * 1024 * 1024
/** Bounded git diagnostic carried in a lane refusal. */
const MAX_DIAGNOSTIC_CHARS = 1_024

/**
 * Own one Lead's lane records and checkpoints. Every mutation for a Lead is
 * serialized, so a checkpoint cannot observe a removal half-complete.
 */
export class LaneLifecycleManager {
  private readonly gnkHome: string
  private readonly maxPatchBytes: number
  private readonly runGit: WorktreeGitRunner
  private readonly queues = new Map<string, Promise<unknown>>()

  /**
   * @param options - harness home, patch ceiling, and git process boundary.
   */
  constructor(options: LaneLifecycleManagerOptions) {
    this.gnkHome = resolve(options.gnkHome)
    this.maxPatchBytes = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES
    this.runGit = options.runGit ?? hostGit
  }

  /**
   * Create one isolated checkout and settle its record `ready`.
   * @param request - Lead, lane, child, repository cwd, scopes, and cancellation.
   * @returns the ready record with its checkout path.
   */
  async create(request: LaneCreateRequest): Promise<LaneRecord> {
    return await this.enqueue(request.sessionId, async () => {
      request.signal.throwIfAborted()
      const lane = LaneName(laneSegment(request.lane, 'lane'))
      const scopes = [...new Set(request.writeScopes.map(writeScope))]
      const cwd = this.assertCreateInputs({ ...request, writeScopes: scopes }, lane)
      const repositoryRoot = await this.repositoryRoot(cwd, request.signal)
      const manager = new WorktreeManager({
        repositoryRoot,
        gnkHome: this.gnkHome,
        runGit: this.runGit,
      })
      const active = await this.activeScopes(request.sessionId)
      assertDisjointLaneScopes({ lane, writeScopes: scopes }, active)

      const planned = {
        version: 1,
        sessionId: request.sessionId,
        lane,
        childSessionId: request.childSessionId,
        repositoryRoot,
        path: join(this.gnkHome, 'worktrees', request.sessionId, lane),
        branch: laneBranch(request.sessionId, lane),
        baseRevision: GitRevision(''),
        writeScopes: scopes,
        stage: 'preparing' as const,
        createdAt: Date.now(),
      } satisfies LaneRecord
      await this.write(planned)

      let checkout: LaneWorktree
      try {
        checkout = await manager.create({ sessionId: request.sessionId, lane, signal: request.signal })
      } catch (error: unknown) {
        await this.failPreparing(planned, error)
        throw error
      }
      const ready: LaneRecord = {
        ...planned,
        path: checkout.path,
        branch: checkout.branch,
        baseRevision: checkout.baseRevision,
        stage: 'ready',
      }
      await this.write(ready)
      return ready
    })
  }

  /**
   * Report every lane record of one Lead, ordered by lane name.
   * @param sessionId - Lead Session owning the records.
   * @returns detached records, including terminal ones.
   */
  async list(sessionId: SessionId): Promise<LaneRecord[]> {
    return await this.enqueue(sessionId, async () => await this.readAll(sessionId))
  }

  /**
   * Report the scopes of lanes that still hold a writable checkout.
   * @param sessionId - Lead Session owning the records.
   * @returns active lane identities and scopes.
   */
  async activeScopes(sessionId: SessionId): Promise<ActiveLaneScope[]> {
    return (await this.readAll(sessionId))
      .filter(record => record.stage === 'ready' || record.stage === 'closing')
      .map(record => ({ lane: record.lane, writeScopes: record.writeScopes }))
  }

  /**
   * Verify the lane checkout still sits on its recorded base commit. A moved
   * HEAD is durable evidence that a member bypassed its tool guard, so the
   * record is quarantined and never integrable afterward.
   * @param record - lane record to verify.
   * @param signal - cancellation for the git read.
   */
  async assertUnmoved(record: LaneRecord, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const head = GitRevision((await this.git(['rev-parse', 'HEAD'], signal, record.path)).trim())
    if (head === record.baseRevision) return
    const quarantined: LaneRecord = {
      ...record,
      stage: 'quarantined',
      diagnostic: `lane HEAD ${head} moved from recorded base ${record.baseRevision}`,
    }
    await this.write(quarantined)
    throw new TeamError(
      `lane "${record.lane}" HEAD moved from recorded base ${record.baseRevision}; refusing to integrate`,
      'TEAM_LANE_HEAD_MOVED',
    )
  }

  /**
   * Stage every tracked and untracked lane change and store its exact patch
   * below the lane record directory. The record keeps the reviewed hash.
   * @param record - ready lane record.
   * @param signal - cancellation for git and file work.
   * @returns the checkpoint hash, path, and byte length.
   */
  async checkpoint(record: LaneRecord, signal: AbortSignal): Promise<LaneCheckpoint> {
    return await this.enqueue(record.sessionId, async () => {
      const current = await this.read(record.sessionId, record.lane)
      return await this.checkpointLocked(current, signal)
    })
  }

  /** Checkpoint one record while its Lead's lane queue is already held. */
  private async checkpointLocked(current: LaneRecord, signal: AbortSignal): Promise<LaneCheckpoint> {
    signal.throwIfAborted()
    if (current.stage !== 'ready') {
      throw new TeamError(
        `lane "${current.lane}" is ${current.stage} and cannot be checkpointed`,
        'TEAM_LANE_NOT_READY',
      )
    }
    await this.assertUnmoved(current, signal)
    await this.git(['add', '-A'], signal, current.path)
    const patch = await this.git(
      ['diff', '--cached', '--binary', '--full-index', '--no-color', current.baseRevision],
      signal,
      current.path,
    )
    const bytes = Buffer.from(patch, 'utf8')
    if (bytes.byteLength > this.maxPatchBytes) {
      throw new TeamError(
        `lane "${current.lane}" patch is ${bytes.byteLength} bytes, above the ${this.maxPatchBytes}-byte ceiling`,
        'TEAM_LANE_PATCH_TOO_LARGE',
      )
    }
    const hash = createHash('sha256').update(bytes).digest('hex')
    const path = this.patchPath(current.sessionId, current.lane, hash)
    await mkdir(join(this.recordDir(current.sessionId, current.lane), 'patches'), { recursive: true })
    await writeFile(path, bytes)
    const checkpoint: LaneCheckpoint = Object.freeze({ hash, path, bytes: bytes.byteLength, at: Date.now() })
    await this.write({ ...current, checkpoint })
    return checkpoint
  }

  /**
   * Read the exact reviewed patch bytes for integration.
   * @param record - lane record with a checkpoint.
   * @param hash - expected SHA-256 of the patch bytes.
   * @param signal - cancellation for the file read.
   * @returns the patch bytes.
   */
  async readPatch(record: LaneRecord, hash: string, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted()
    const current = await this.read(record.sessionId, record.lane)
    const checkpoint = current.checkpoint
    if (checkpoint === undefined) {
      throw new TeamError(`lane "${current.lane}" has no checkpoint`, 'TEAM_LANE_NO_CHECKPOINT')
    }
    if (checkpoint.hash !== hash) {
      throw new TeamError(
        `lane "${current.lane}" checkpoint ${checkpoint.hash} does not match reviewed hash ${hash}`,
        'TEAM_LANE_PATCH_CHANGED',
      )
    }
    const expectedPath = this.patchPath(current.sessionId, current.lane, hash)
    if (checkpoint.path !== expectedPath) {
      throw new TeamError(
        `lane "${record.lane}" patch path does not match its reviewed hash`,
        'TEAM_LANE_PATCH_CHANGED',
      )
    }
    const bytes = await readFile(expectedPath)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== hash) {
      throw new TeamError(
        `lane "${record.lane}" patch bytes changed since checkpoint (${actual} != ${hash})`,
        'TEAM_LANE_PATCH_CHANGED',
      )
    }
    return bytes
  }

  /**
   * Complete a successful merge: checkpoint the lane, remove its checkout and
   * branch, and keep the patch as merge evidence.
   * @param record - ready lane record.
   * @param reviewedHash - exact patch hash the Lead integrated.
   * @param signal - cancellation for checkpoint and removal.
   * @returns the merged checkpoint.
   */
  async settleMerged(
    record: LaneRecord,
    reviewedHash: string,
    signal: AbortSignal,
  ): Promise<LaneCheckpoint> {
    return await this.enqueue(record.sessionId, async () => {
      const current = await this.read(record.sessionId, record.lane)
      const checkpoint = await this.checkpointLocked(current, signal)
      if (checkpoint.hash !== reviewedHash) {
        throw new TeamError(
          `lane "${current.lane}" changed after integration (${checkpoint.hash} != ${reviewedHash}); checkout kept`,
          'TEAM_LANE_PATCH_CHANGED',
        )
      }
      return await this.close(current, 'merged', checkpoint, signal)
    })
  }

  /**
   * Explicitly discard a lane: checkpoint first so unmerged work survives as a
   * patch, then remove the checkout and branch.
   * @param record - ready lane record.
   * @param signal - cancellation for checkpoint and removal.
   * @returns the preserved checkpoint.
   */
  async discard(record: LaneRecord, signal: AbortSignal): Promise<LaneCheckpoint> {
    return await this.enqueue(record.sessionId, async () => {
      const current = await this.read(record.sessionId, record.lane)
      if (current.stage !== 'ready') {
        throw new TeamError(
          `lane "${current.lane}" is ${current.stage} and cannot be discarded`,
          'TEAM_LANE_NOT_READY',
        )
      }
      const checkpoint = await this.checkpointLocked(current, signal)
      return await this.close(current, 'discarded', checkpoint, signal)
    })
  }

  /**
   * Finish interrupted create, close, or remove transactions recorded for one
   * Lead. Ready lanes are left untouched because they may hold the only copy
   * of unmerged work.
   * @param sessionId - Lead Session whose records are reconciled.
   * @param signal - cancellation for recovery.
   */
  async recover(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    await this.enqueue(sessionId, async () => {
      for (const record of await this.readAll(sessionId)) {
        signal.throwIfAborted()
        if (record.stage !== 'preparing' && record.stage !== 'closing') continue
        const manager = new WorktreeManager({
          repositoryRoot: record.repositoryRoot,
          gnkHome: this.gnkHome,
          runGit: this.runGit,
        })
        try {
          await manager.remove({ sessionId, lane: record.lane, signal })
        } catch (error: unknown) {
          const failed: LaneRecord = {
            ...record,
            stage: 'failed',
            diagnostic: `lane recovery removal failed: ${errorMessage(error)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
          }
          await this.write(failed)
          continue
        }
        if (record.stage === 'closing') {
          await this.write({
            ...record,
            stage: record.diagnostic === 'merged' ? 'merged' : 'discarded',
            diagnostic: 'interrupted lane removal completed by startup recovery',
          })
        } else {
          await this.write({
            ...record,
            stage: 'failed',
            diagnostic: 'interrupted lane creation was rolled back by startup recovery',
          })
        }
      }
    })
  }

  /**
   * Run one operation after every earlier operation for the same Lead.
   * @param sessionId - serialization key.
   * @param operation - admitted lane mutation.
   * @returns the operation result.
   */
  private async enqueue<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const tracked = next.catch(() => undefined)
    this.queues.set(sessionId, tracked)
    try {
      return await next
    } finally {
      if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId)
    }
  }

  /**
   * Reject a create request that cannot produce a safe isolated lane.
   * @returns the non-empty Lead cwd used to locate the repository root.
   */
  private assertCreateInputs(request: LaneCreateRequest, lane: LaneName): string {
    if (request.writeScopes.length === 0) {
      throw new TeamError('an isolated lane requires write scopes', 'TEAM_INVALID_LANE_POLICY')
    }
    const cwd = request.cwd?.trim()
    if (cwd === undefined || cwd.length === 0) {
      throw new TeamError(
        `lane "${lane}" needs the Lead checkout to locate its repository root`,
        'TEAM_LANE_NO_REPOSITORY',
      )
    }
    if (lstatSync(join(this.recordDir(request.sessionId, lane), 'lane.json'), { throwIfNoEntry: false }) !== undefined) {
      throw new TeamError(`lane "${lane}" already has a durable record`, 'TEAM_LANE_DUPLICATE')
    }
    return cwd
  }

  /** Discover the canonical repository root from the Lead checkout. */
  private async repositoryRoot(cwd: string, signal: AbortSignal): Promise<string> {
    try {
      const output = await this.runGit({ argv: ['rev-parse', '--show-toplevel'], cwd, signal })
      const root = output.trim()
      if (root.length === 0) throw new Error('git printed no repository root')
      return resolve(root)
    } catch (error: unknown) {
      throw new TeamError(
        `Lead checkout ${cwd} is not inside a Git work tree: ${errorMessage(error)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
        'TEAM_LANE_NO_REPOSITORY',
        { cause: error },
      )
    }
  }

  /** Remove a partially created checkout and settle the preparing record failed. */
  private async failPreparing(record: LaneRecord, failure: unknown): Promise<void> {
    const managerCleanup = new WorktreeManager({
      repositoryRoot: record.repositoryRoot,
      gnkHome: this.gnkHome,
      runGit: this.runGit,
    })
    try {
      await managerCleanup.remove({
        sessionId: record.sessionId,
        lane: record.lane,
        signal: new AbortController().signal,
      })
    } catch (cleanupError: unknown) {
      await this.write({
        ...record,
        stage: 'failed',
        diagnostic: `lane creation failed (${errorMessage(failure)}); cleanup also failed: ${errorMessage(cleanupError)}`
          .slice(0, MAX_DIAGNOSTIC_CHARS),
      })
      throw new AggregateError([failure, cleanupError], `lane "${record.lane}" creation and cleanup both failed`)
    }
    await this.write({
      ...record,
      stage: 'failed',
      diagnostic: `lane creation failed: ${errorMessage(failure)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
    })
  }

  /** Mark the record closing, remove the checkout, then record the terminal stage. */
  private async close(
    record: LaneRecord,
    terminal: 'merged' | 'discarded',
    checkpoint: LaneCheckpoint,
    signal: AbortSignal,
  ): Promise<LaneCheckpoint> {
    const closing: LaneRecord = { ...record, checkpoint, stage: 'closing', diagnostic: terminal }
    await this.write(closing)
    const manager = new WorktreeManager({
      repositoryRoot: record.repositoryRoot,
      gnkHome: this.gnkHome,
      runGit: this.runGit,
    })
    await manager.remove({ sessionId: record.sessionId, lane: record.lane, signal })
    const settled: LaneRecord = {
      version: closing.version,
      sessionId: closing.sessionId,
      lane: closing.lane,
      childSessionId: closing.childSessionId,
      repositoryRoot: closing.repositoryRoot,
      path: closing.path,
      branch: closing.branch,
      baseRevision: closing.baseRevision,
      writeScopes: closing.writeScopes,
      stage: terminal,
      createdAt: closing.createdAt,
      checkpoint,
    }
    await this.write(settled)
    return checkpoint
  }

  /** Read every well-formed record for one Lead. */
  private async readAll(sessionId: SessionId): Promise<LaneRecord[]> {
    const dir = this.sessionDir(sessionId)
    let entries: string[]
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch (error: unknown) {
      if (isMissing(error)) return []
      throw error
    }
    const records: LaneRecord[] = []
    for (const entry of entries.sort()) {
      const path = join(dir, entry, 'lane.json')
      if (lstatSync(path, { throwIfNoEntry: false }) === undefined) continue
      records.push(await this.parseRecord(path))
    }
    return records.sort((left, right) => left.lane.localeCompare(right.lane))
  }

  /** Read one record by lane, refusing an absent or terminal record. */
  private async read(sessionId: SessionId, lane: string): Promise<LaneRecord> {
    const path = join(this.recordDir(sessionId, lane), 'lane.json')
    try {
      return await this.parseRecord(path)
    } catch (error: unknown) {
      if (isMissing(error)) {
        throw new TeamError(`lane "${lane}" has no durable record`, 'TEAM_LANE_NOT_FOUND')
      }
      throw error
    }
  }

  /** Parse and validate one record at the durable/file boundary. */
  private async parseRecord(path: string): Promise<LaneRecord> {
    const raw = await readFile(path, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new TeamError(`lane record ${path} is not valid JSON`, 'TEAM_LANE_RECORD_INVALID')
    }
    if (!isLaneRecord(parsed)) {
      throw new TeamError(`lane record ${path} has an invalid format`, 'TEAM_LANE_RECORD_INVALID')
    }
    return Object.freeze(parsed)
  }

  /** Write one record atomically. */
  private async write(record: LaneRecord): Promise<void> {
    const dir = this.recordDir(record.sessionId, record.lane)
    await mkdir(dir, { recursive: true })
    const target = join(dir, 'lane.json')
    const temporary = join(dir, `.lane-${process.pid}-${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(record, undefined, 2)}\n`)
    await rename(temporary, target)
  }

  /** Directory holding one Lead's lane records. */
  private sessionDir(sessionId: SessionId): string {
    return join(this.gnkHome, 'lanes', sessionId)
  }

  /** Directory holding one lane record and its patches. */
  private recordDir(sessionId: SessionId, lane: string): string {
    return join(this.sessionDir(sessionId), lane)
  }

  /** Canonical patch path derived only from the lane identity and reviewed hash. */
  private patchPath(sessionId: SessionId, lane: string, hash: string): string {
    return join(this.recordDir(sessionId, lane), 'patches', `${hash}.patch`)
  }

  /** Run one lifecycle-owned git invocation. */
  private async git(argv: readonly string[], signal: AbortSignal, cwd: string): Promise<string> {
    try {
      return await this.runGit({ argv, cwd, signal })
    } catch (error: unknown) {
      throw new TeamError(
        `git ${argv.join(' ')} failed in ${cwd}: ${errorMessage(error)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
        'TEAM_LANE_GIT_FAILED',
        { cause: error },
      )
    }
  }
}

/** Host git boundary sharing the worktree runner's bounded output. */
const hostGit: WorktreeGitRunner = async ({ argv, cwd, signal }) => {
  return await new Promise<string>((settle, fail) => {
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
}

/** Whether one filesystem error means the recorded path is absent. */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Strict schema for one durable lane record. */
const laneRecordSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  lane: z.string().min(1),
  childSessionId: z.string().min(1),
  repositoryRoot: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1),
  // A create that failed before checkout recorded no base; ready records always carry one.
  baseRevision: z.string(),
  writeScopes: z.array(z.string().min(1)),
  stage: z.enum(['preparing', 'ready', 'closing', 'merged', 'discarded', 'quarantined', 'failed']),
  createdAt: z.number().int().nonnegative(),
  checkpoint: z.object({
    hash: z.string().min(1),
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    at: z.number().int().nonnegative(),
  }).strict().optional(),
  diagnostic: z.string().optional(),
}).strict()

/**
 * Validate one parsed lane record at the file boundary.
 * @param value - decoded JSON value.
 * @returns true when every field matches the durable record contract.
 */
function isLaneRecord(value: unknown): value is LaneRecord {
  return laneRecordSchema.safeParse(value).success
}

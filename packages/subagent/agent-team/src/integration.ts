/**
 * Reviewed lane integration: one serialized, gate-verified patch application
 * per Lead. A moved lane HEAD, a stale reviewed hash, a dirty primary
 * checkout, a conflict, or a failed gate stops the queue and leaves the lane
 * and its checkpoint intact.
 * @module @greeneek/gnk-agent-team/integration
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SessionId } from '@greeneek/gnk-session/types'
import { errorMessage, TeamError } from './error.ts'
import type { LaneLifecycleManager } from './lane-lifecycle.ts'
import type { LaneRecord } from './lane-lifecycle.ts'
import { GitRevision } from './worktrees.ts'
import type { GitRevision as GitRevisionType, WorktreeGitRunner } from './worktrees.ts'

/** One gate command, handed to the process boundary unchanged. */
export interface LaneGateCommand {
  /** Executable and arguments; `argv[0]` is the program. */
  readonly argv: readonly string[]
}

/** One integration request for a reviewed lane patch. */
export interface LaneMergeRequest {
  /** Lead Session that owns the lane and its serialized merge queue. */
  readonly sessionId: SessionId
  /** Durable lane name. */
  readonly lane: string
  /** Primary checkout HEAD the Lead reviewed before queueing this lane. */
  readonly expectedPrimaryHead: string
  /** SHA-256 of the exact patch bytes the Lead reviewed. */
  readonly patchHash: string
  /** Gate commands run in the primary checkout after the patch applies. */
  readonly gateCommands: readonly LaneGateCommand[]
  /** Exact commit message for the integration commit. */
  readonly commitMessage: string
  /** Cancels patch application, gates, commit, and cleanup. */
  readonly signal: AbortSignal
}

/** One passed gate and its captured output. */
export interface LaneGateEvidence {
  /** Executable and arguments that ran. */
  readonly argv: readonly string[]
  /** Captured stdout, truncated to the configured ceiling. */
  readonly output: string
}

/** Result of one successful integration. */
export interface LaneMergeResult {
  /** Merged lane name. */
  readonly lane: string
  /** Exact reviewed patch hash. */
  readonly patchHash: string
  /** Primary commit produced by the integration. */
  readonly primaryHead: GitRevisionType
  /** Gate evidence recorded for the merge. */
  readonly gates: readonly LaneGateEvidence[]
}

/** Process boundary for one gate command. */
export type LaneGateRunner = (invocation: {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly signal: AbortSignal
}) => Promise<string>

/** Options binding integration to one harness home and git boundary. */
export interface LaneIntegrationOptions {
  /** Lane record and checkpoint owner. */
  readonly lanes: LaneLifecycleManager
  /**
   * Git process boundary; omitted runs the host `git`.
   * @see WorktreeGitRunner
   */
  readonly runGit?: WorktreeGitRunner
  /**
   * Gate process boundary; omitted runs the host executable.
   * @see LaneGateRunner
   */
  readonly runGate?: LaneGateRunner
  /** Upper bound on retained gate output. */
  readonly maxGateOutputBytes?: number
}

/** Default retained gate output per command. */
const DEFAULT_MAX_GATE_OUTPUT_BYTES = 65_536
/** Bounded diagnostic carried in an integration refusal. */
const MAX_DIAGNOSTIC_CHARS = 2_048

/**
 * Serialize lane integration per Lead and halt a Lead's queue after the first
 * refusal, so one conflict or gate failure cannot be followed by an
 * unreviewed sibling merge.
 */
export class LaneIntegration {
  private readonly lanes: LaneLifecycleManager
  private readonly runGit: WorktreeGitRunner
  private readonly runGate: LaneGateRunner
  private readonly maxGateOutputBytes: number
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly halted = new Map<string, string>()

  /**
   * @param options - lane records, git boundary, gate boundary, and output ceiling.
   */
  constructor(options: LaneIntegrationOptions) {
    this.lanes = options.lanes
    this.runGit = options.runGit ?? hostGit
    this.runGate = options.runGate ?? hostGate
    this.maxGateOutputBytes = options.maxGateOutputBytes ?? DEFAULT_MAX_GATE_OUTPUT_BYTES
  }

  /**
   * Apply one reviewed patch, run every gate, commit, and remove the merged
   * lane. The first failure halts this Lead's queue until {@link resume}.
   * @param request - lane, expected primary HEAD, reviewed hash, gates, and commit text.
   * @returns the primary commit and gate evidence.
   */
  async integrate(request: LaneMergeRequest): Promise<LaneMergeResult> {
    return await this.enqueue(request.sessionId, async () => {
      const halted = this.halted.get(request.sessionId)
      if (halted !== undefined) {
        throw new TeamError(`lane integration queue is halted: ${halted}`, 'TEAM_LANE_QUEUE_HALTED')
      }
      try {
        return await this.integrateNow(request)
      } catch (error: unknown) {
        if (error instanceof TeamError) {
          this.halted.set(request.sessionId, error.message.slice(0, MAX_DIAGNOSTIC_CHARS))
        }
        throw error
      }
    })
  }

  /**
   * Allow the Lead's merge queue to accept later lanes after investigating a
   * stopped one. The halted lane keeps its checkout and checkpoint.
   * @param sessionId - Lead Session whose queue is resumed.
   */
  resume(sessionId: SessionId): void {
    this.halted.delete(sessionId)
  }

  /** Whether one Lead's queue is halted and the diagnostic that stopped it. */
  haltReason(sessionId: SessionId): string | undefined {
    return this.halted.get(sessionId)
  }

  /** Perform one admitted integration while the Lead's queue is held. */
  private async integrateNow(request: LaneMergeRequest): Promise<LaneMergeResult> {
    request.signal.throwIfAborted()
    const record = (await this.lanes.list(request.sessionId)).find(candidate => candidate.lane === request.lane)
    if (record === undefined) throw new TeamError(`lane "${request.lane}" not found`, 'TEAM_LANE_NOT_FOUND')
    if (record.stage !== 'ready') {
      throw new TeamError(`lane "${request.lane}" is ${record.stage} and cannot merge`, 'TEAM_LANE_NOT_READY')
    }
    const primaryHead = await this.head(record.repositoryRoot, request.signal)
    if (primaryHead !== request.expectedPrimaryHead) {
      throw new TeamError(
        `primary HEAD ${primaryHead} does not match expected ${request.expectedPrimaryHead}`,
        'TEAM_LANE_PRIMARY_MOVED',
      )
    }
    const status = (await this.git(['status', '--porcelain'], request.signal, record.repositoryRoot)).trim()
    if (status.length > 0) {
      throw new TeamError('primary checkout is not clean; commit or discard its changes first', 'TEAM_LANE_PRIMARY_DIRTY')
    }

    // Re-checkpoint first: a lane that changed after review must be reviewed
    // again, not silently merged at the old hash.
    const checkpoint = await this.lanes.checkpoint(record, request.signal)
    if (checkpoint.hash !== request.patchHash) {
      throw new TeamError(
        `lane "${request.lane}" changed after review (${checkpoint.hash} != ${request.patchHash})`,
        'TEAM_LANE_PATCH_CHANGED',
      )
    }
    const patch = await this.lanes.readPatch(record, request.patchHash, request.signal)

    const gates: LaneGateEvidence[] = []
    if (patch.byteLength === 0) {
      for (const gate of request.gateCommands) {
        const output = await this.gate(gate.argv, record.repositoryRoot, request.signal)
        gates.push({ argv: [...gate.argv], output })
      }
      await this.lanes.settleMerged(record, request.patchHash, request.signal)
      return {
        lane: record.lane,
        patchHash: request.patchHash,
        primaryHead,
        gates,
      }
    }

    await this.applyOrRefuse(record, patch, request.signal)
    try {
      for (const gate of request.gateCommands) {
        const output = await this.gate(gate.argv, record.repositoryRoot, request.signal)
        gates.push({ argv: [...gate.argv], output })
      }
      await this.git(['add', '-A'], request.signal, record.repositoryRoot)
      await this.git(
        ['commit', '-m', request.commitMessage],
        request.signal,
        record.repositoryRoot,
      )
    } catch (error: unknown) {
      const rollback = await this.rollback(record, patch, request.signal)
      throw new TeamError(
        `lane "${request.lane}" integration failed: ${errorMessage(error)}; ${rollback}`.slice(0, MAX_DIAGNOSTIC_CHARS),
        error instanceof TeamError && error.code === 'TEAM_LANE_GATE_FAILED'
          ? 'TEAM_LANE_GATE_FAILED'
          : 'TEAM_LANE_INTEGRATION_FAILED',
        { cause: error },
      )
    }

    const mergedHead = await this.head(record.repositoryRoot, request.signal)
    await this.lanes.settleMerged(record, request.patchHash, request.signal)
    return {
      lane: record.lane,
      patchHash: request.patchHash,
      primaryHead: mergedHead,
      gates,
    }
  }

  /** Check then apply the exact patch, refusing a conflict before any write. */
  private async applyOrRefuse(record: LaneRecord, patch: Buffer, signal: AbortSignal): Promise<void> {
    const patchFile = await this.writeTemporaryPatch(record, patch)
    try {
      await this.git(['apply', '--check', '--index', '--binary', patchFile], signal, record.repositoryRoot)
    } catch (error: unknown) {
      throw new TeamError(
        `lane "${record.lane}" conflicts with the primary checkout: ${errorMessage(error)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
        'TEAM_LANE_MERGE_CONFLICT',
        { cause: error },
      )
    }
    try {
      await this.git(['apply', '--index', '--binary', patchFile], signal, record.repositoryRoot)
    } finally {
      await this.removeTemporaryPatch(patchFile)
    }
  }

  /** Reverse one applied patch and report whether the primary is clean again. */
  private async rollback(record: LaneRecord, patch: Buffer, signal: AbortSignal): Promise<string> {
    const patchFile = await this.writeTemporaryPatch(record, patch)
    try {
      await this.git(['apply', '-R', '--index', '--binary', patchFile], signal, record.repositoryRoot)
      return 'the applied patch was reversed and the lane checkout is intact'
    } catch (error: unknown) {
      return `automatic reversal failed, inspect the primary checkout before retrying: ${errorMessage(error)}`
    } finally {
      await this.removeTemporaryPatch(patchFile)
    }
  }

  /** Store one temporary patch file for git, outside the reviewed evidence path. */
  private async writeTemporaryPatch(record: LaneRecord, patch: Buffer): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), `gnk-lane-${record.lane}-`))
    const path = join(directory, 'reviewed.patch')
    await writeFile(path, patch)
    return path
  }

  /** Remove one temporary patch file and its directory. */
  private async removeTemporaryPatch(path: string): Promise<void> {
    await rm(dirname(path), { recursive: true, force: true })
  }

  /** Run one gate and preserve a bounded output excerpt. */
  private async gate(argv: readonly string[], cwd: string, signal: AbortSignal): Promise<string> {
    try {
      const output = await this.runGate({ argv, cwd, signal })
      return output.slice(-this.maxGateOutputBytes)
    } catch (error: unknown) {
      throw new TeamError(
        `gate ${argv.join(' ')} failed: ${errorMessage(error)}`.slice(0, MAX_DIAGNOSTIC_CHARS),
        'TEAM_LANE_GATE_FAILED',
        { cause: error },
      )
    }
  }

  /** Read one checkout's current commit. */
  private async head(cwd: string, signal: AbortSignal): Promise<GitRevisionType> {
    return GitRevision((await this.git(['rev-parse', 'HEAD'], signal, cwd)).trim())
  }

  /** Run one integration-owned git invocation. */
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

  /** Run one operation after every earlier operation for the same Lead. */
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
}

/** Host git boundary with bounded captured output. */
const hostGit: WorktreeGitRunner = async ({ argv, cwd, signal }) => await new Promise<string>((settle, fail) => {
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

/** Host gate boundary; a nonzero exit rejects with its captured stderr. */
const hostGate: LaneGateRunner = async ({ argv, cwd, signal }) => {
  const [executable, ...args] = argv
  if (executable === undefined) throw new Error('gate command has no executable')
  return await new Promise<string>((settle, fail) => {
    execFile(executable, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      signal,
      windowsHide: true,
      env: { ...process.env, CI: '1' },
    }, (error, stdout, stderr) => {
      if (error === null) {
        settle(stdout)
        return
      }
      fail(new Error(`${error.message}: ${stderr.trim()}`.slice(0, MAX_DIAGNOSTIC_CHARS)))
    })
  })
}

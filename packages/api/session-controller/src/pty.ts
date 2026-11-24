/**
 * Interactive PTY Remotes. Sessions are created by the Host inside a registered
 * Workspace, stream output to browser/desktop clients, and accept stdin, resize
 * and close. Allocation, output framing and process-tree teardown are delegated
 * to the Subprocess terminal capability so the Web Host cannot bypass the
 * platform-safe process controls with a raw node-pty call.
 */
import { resolve, sep } from 'node:path'
import type { Context } from '@greeneek/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
// Type-only: pulls the ctx.subprocess Context merge into this Host program.
import type {} from '@greeneek/gnk-subprocess'
import type { SubprocessTerminalHandle } from '@greeneek/gnk-subprocess'
import type { PtyFrame, PtyOpenRequest, PtySessionInfo } from './types.ts'
import { frameStream } from './frame-stream.ts'

/** One allocated PTY and the grid facts reported to clients. */
interface PtyRecord {
  /** Provider-owned terminal handle. */
  readonly handle: SubprocessTerminalHandle
  /** Workspace directory the shell started in. */
  readonly cwd: string
  /** Current column count. */
  cols: number
  /** Current row count. */
  rows: number
  /** Guards against publishing two exit frames for one session. */
  exited: boolean
}

/** Terminate grace for an interactive shell session. */
const PTY_GRACE_MS = 3000

/** Credential-free PTY controller mounted as the `pty` Remote namespace. */
export class PtyController extends TypertRemoteService {
  static inject = ['workspaceRegistry', 'subprocess']

  private readonly sessions = new Map<string, PtyRecord>()
  private readonly listeners = new Map<string, Set<(frame: PtyFrame) => void>>()
  private counter = 0

  /** @param ctx - Host context with the Workspace registry. */
  constructor(ctx: Context) {
    super(ctx, 'ptyController', { namespace: 'pty' })
    ctx.effect(() => async () => {
      await Promise.all([...this.sessions.keys()].map(id => this.destroy(id)))
    }, 'pty: close all')
  }

  /**
   * Open one PTY inside a registered Workspace.
   * @param request - workspace path and initial grid size.
   * @returns the minted session id and the clamped grid.
   */
  @Remote('open')
  async open(request: PtyOpenRequest): Promise<PtySessionInfo> {
    const cwd = this.workspacePath(request.path)
    const cols = clamp(request.cols, 20, 400)
    const rows = clamp(request.rows, 5, 200)
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/bash')
    const id = `pty-${++this.counter}`
    const handle = await this.ctx.subprocess.spawnTerminal({
      argv: [shell],
      cwd,
      cols,
      rows,
      graceMs: PTY_GRACE_MS,
    })
    const record: PtyRecord = { handle, cwd, cols, rows, exited: false }
    this.sessions.set(id, record)
    handle.output.on('data', (chunk: Buffer) => {
      this.publish(id, { type: 'data', data: String(chunk) })
    })
    void handle.done.then(
      (outcome) => { this.finish(id, outcome.exitCode ?? null) },
      () => { this.finish(id, null) },
    )
    return { id, cwd, cols, rows }
  }

  /**
   * Write UTF-8 bytes into a live PTY's stdin.
   * @param request - session id and text.
   */
  @Remote('write')
  async write(request: { id: string; data: string }): Promise<void> {
    await this.session(request.id).handle.write(request.data)
  }

  /**
   * Resize a live PTY's terminal grid.
   * @param request - session id and grid size.
   */
  @Remote('resize')
  resize(request: { id: string; cols: number; rows: number }): void {
    const record = this.session(request.id)
    const cols = clamp(request.cols, 20, 400)
    const rows = clamp(request.rows, 5, 200)
    record.handle.resize(cols, rows)
    record.cols = cols
    record.rows = rows
  }

  /**
   * Terminate one PTY and its captured process tree.
   * @param request - session id.
   */
  @Remote('close')
  async close(request: { id: string }): Promise<void> {
    await this.destroy(request.id)
  }

  /**
   * List live PTY sessions with their real workspace directories.
   * @returns session summaries.
   */
  @Remote('list')
  list(): PtySessionInfo[] {
    return [...this.sessions.entries()].map(([id, record]) => ({
      id, cwd: record.cwd, cols: record.cols, rows: record.rows,
    }))
  }

  /**
   * Stream one PTY's data and exit frames from the moment of subscription.
   * @param request - session id.
   * @param signal - stream lifetime; cancellation detaches the listener.
   * @returns a complete queue of live frames.
   */
  @Remote({ mode: 'stream' })
  async *events(request: { id: string }, signal: AbortSignal): AsyncIterable<PtyFrame> {
    this.session(request.id)
    yield* frameStream<PtyFrame>((push) => {
      const listeners = this.listeners.get(request.id) ?? new Set()
      listeners.add(push)
      this.listeners.set(request.id, listeners)
      return () => {
        listeners.delete(push)
        if (listeners.size === 0) this.listeners.delete(request.id)
      }
    }, signal, () => this.sessions.has(request.id))
  }

  /** Resolve one live session or refuse with a stable wire error. */
  private session(id: string): PtyRecord {
    const record = this.sessions.get(id)
    if (record === undefined) throw new RemoteError('pty/not-found', `unknown PTY session ${id}`, { id })
    return record
  }

  /** Only paths inside a registered Workspace can host a PTY. */
  private workspacePath(path: string): string {
    const target = resolve(path)
    const allowed = this.ctx.workspaceRegistry.list().some((workspace) => {
      const root = resolve(workspace.path)
      return target === root || target.startsWith(root + sep)
    })
    if (!allowed) throw new RemoteError('pty/bad-cwd', `path is outside every workspace: ${path}`, { path })
    return target
  }

  /** Publish one frame to every attached client. */
  private publish(id: string, frame: PtyFrame): void {
    for (const listener of this.listeners.get(id) ?? []) listener(frame)
  }

  /** Publish exactly one exit frame and drop the session. */
  private finish(id: string, exitCode: number | null): void {
    const record = this.sessions.get(id)
    if (record === undefined || record.exited) return
    record.exited = true
    this.sessions.delete(id)
    this.publish(id, { type: 'exit', exitCode })
  }

  /** Terminate one PTY idempotently through the provider's process-tree teardown. */
  private async destroy(id: string): Promise<void> {
    const record = this.sessions.get(id)
    if (record === undefined) return
    await record.handle.terminate()
    this.finish(id, null)
  }
}

/** Clamp a terminal grid dimension. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)))
}

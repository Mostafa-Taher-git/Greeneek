/**
 * Interactive PTY Remotes. Sessions are created by the Host inside a registered
 * Workspace, stream output to browser/desktop clients, and accept stdin, resize
 * and close. The same Host process owns the child tree, so Agents and the user
 * operate the same runtime under the existing workspace policy.
 */
import { resolve, sep } from 'node:path'
import type { Context } from '@greeneek/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import * as pty from 'node-pty'
import type { PtyFrame, PtyOpenRequest, PtySessionInfo } from './types.ts'

/** Credential-free PTY controller mounted as the `pty` Remote namespace. */
export class PtyController extends TypertRemoteService {
  static inject = ['workspaceRegistry']

  private readonly sessions = new Map<string, pty.IPty>()
  private readonly listeners = new Map<string, Set<(frame: PtyFrame) => void>>()

  /** @param ctx - Host context with the Workspace registry. */
  constructor(ctx: Context) {
    super(ctx, 'ptyController', { namespace: 'pty' })
    ctx.effect(() => () => { for (const id of [...this.sessions.keys()]) this.destroy(id) }, 'pty: close all')
  }

  /**
   * Open one PTY inside a registered Workspace.
   * @param request - workspace path and initial grid size.
   * @returns the minted session id.
   */
  @Remote('open')
  open(request: PtyOpenRequest): PtySessionInfo {
    const cwd = this.workspacePath(request.path)
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/bash')
    const id = `pty-${++this.counter}`
    const child = pty.spawn(shell, [], {
      name: 'xterm-color',
      cwd,
      cols: clamp(request.cols, 20, 400),
      rows: clamp(request.rows, 5, 200),
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    child.onData((data) => { this.publish(id, { type: 'data', data }) })
    child.onExit(({ exitCode }) => { this.publish(id, { type: 'exit', exitCode }); this.sessions.delete(id) })
    this.sessions.set(id, child)
    return { id, cwd, cols: request.cols, rows: request.rows }
  }

  /** Monotonic session id counter. */
  private counter = 0

  /**
   * Write UTF-8 bytes into a live PTY's stdin.
   * @param request - session id and text.
   */
  @Remote('write')
  write(request: { id: string; data: string }): void {
    this.session(request.id).write(request.data)
  }

  /**
   * Resize a live PTY's terminal grid.
   * @param request - session id and grid size.
   */
  @Remote('resize')
  resize(request: { id: string; cols: number; rows: number }): void {
    this.session(request.id).resize(clamp(request.cols, 20, 400), clamp(request.rows, 5, 200))
  }

  /**
   * Terminate one PTY and its captured process tree.
   * @param request - session id.
   */
  @Remote('close')
  close(request: { id: string }): void {
    this.destroy(request.id)
  }

  /**
   * List live PTY sessions.
   * @returns session summaries.
   */
  @Remote('list')
  list(): PtySessionInfo[] {
    return [...this.sessions.entries()].map(([id, child]) => ({
      id, cwd: '', cols: child.cols, rows: child.rows,
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
    const queue: PtyFrame[] = []
    let wake: (() => void) | undefined
    const listener = (frame: PtyFrame): void => {
      queue.push(frame)
      wake?.()
      wake = undefined
    }
    const listeners = this.listeners.get(request.id) ?? new Set()
    listeners.add(listener)
    this.listeners.set(request.id, listeners)
    const onAbort = (): void => { wake?.(); wake = undefined }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        while (queue.length > 0) {
          const frame = queue.shift()
          if (frame !== undefined) yield frame
        }
        if (signal.aborted) return
        if (!this.sessions.has(request.id)) return
        await new Promise<void>((done) => { wake = done })
      }
    } finally {
      listeners.delete(listener)
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** Resolve one live session or refuse with a stable wire error. */
  private session(id: string): pty.IPty {
    const child = this.sessions.get(id)
    if (child === undefined) throw new RemoteError('pty/not-found', `unknown PTY session ${id}`, { id })
    return child
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

  /** Kill one PTY idempotently. */
  private destroy(id: string): void {
    const child = this.sessions.get(id)
    if (child === undefined) return
    this.sessions.delete(id)
    try { child.kill() } catch { /* already exited */ }
    this.publish(id, { type: 'exit', exitCode: null })
  }
}

/** Clamp a terminal grid dimension. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)))
}

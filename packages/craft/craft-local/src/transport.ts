/**
 * Newline-framed JSON-RPC 2.0 transport over one app process.
 *
 * The wire is deliberately minimal: one JSON request per line, one JSON
 * response per line keyed by numeric id. The exact ArtCraft frame shape is
 * unverified in this pilot, so the reader tolerates non-JSON stdout lines
 * (plain app diagnostics) but rejects a malformed result shape.
 * @module @greeneek/gnk-craft-local/transport
 */

import type { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { CraftError } from '@greeneek/gnk-craft'
import type { CraftCallResult, CraftToolDescriptor, CraftTransport } from '@greeneek/gnk-craft'

/** The process surface the transport needs. */
export interface CraftTransportProcess {
  /** Child stdin; must be a pipe. */
  readonly stdin: Writable | undefined
  /** Child stdout; must be a pipe. */
  readonly stdout: Readable | undefined
  /** Resolves at process close; rejects only for spawn-level failures. */
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
  /** Tree-scoped termination. Idempotent. */
  terminate(): void
}

/** Transport tuning. */
export interface CraftTransportOptions {
  /** App method that lists callable tools (`command_list`). */
  readonly listMethod: string
  /** Per-request deadline in milliseconds. */
  readonly requestTimeoutMs: number
  /** Bound on waiting for process settlement during close. */
  readonly closeGraceMs: number
  /**
   * Diagnostic sink for ignored malformed stdout lines.
   * @param message - diagnostic text.
   */
  readonly warn?: (message: string) => void
}

/** One in-flight request. */
interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly dropAbort: () => void
}

/** JSON-RPC response envelope fields the reader relies on. */
interface RpcEnvelope {
  readonly id?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

/**
 * Line-framed JSON-RPC transport. Timeouts and caller cancellation terminate
 * the child tree, which is the manifest's declared cancellation mechanism.
 */
export class JsonRpcCraftTransport implements CraftTransport {
  private readonly process: CraftTransportProcess
  private readonly options: CraftTransportOptions
  private readonly pending = new Map<number, PendingRequest>()
  private readonly decoder = new StringDecoder('utf8')
  private buffer = ''
  private nextId = 1
  private closed = false
  private closePromise: Promise<void> | undefined

  /**
   * @param process - spawned app process with piped stdio.
   * @param options - list method, deadline, close bound, diagnostics.
   */
  constructor(process: CraftTransportProcess, options: CraftTransportOptions) {
    if (process.stdin === undefined || process.stdout === undefined) {
      throw new CraftError(
        'the Craft app process must be spawned with piped stdin and stdout',
        'CRAFT_APP_NOT_READY',
      )
    }
    this.process = process
    this.options = options
    process.stdout.on('data', (chunk: Buffer) => {
      this.receive(this.decoder.write(chunk))
    })
    process.done.then(
      () => {
        this.fail(new CraftError('the Craft app process exited', 'CRAFT_TRANSPORT_CLOSED'))
      },
      (error: unknown) => {
        this.fail(new CraftError('the Craft app process failed to start', 'CRAFT_TRANSPORT_CLOSED', { cause: error }))
      },
    )
  }

  /** {@inheritDoc CraftTransport.listTools} */
  async listTools(): Promise<readonly CraftToolDescriptor[]> {
    const result = await this.request(this.options.listMethod, {})
    const tools = isRecord(result) ? result.tools : undefined
    if (!Array.isArray(tools)) {
      throw new CraftError(
        `the Craft app returned no tool catalog from "${this.options.listMethod}"`,
        'CRAFT_APP_ERROR',
      )
    }
    return tools.map((entry, index) => parseToolDescriptor(entry, index))
  }

  /** {@inheritDoc CraftTransport.callTool} */
  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: { readonly signal: AbortSignal },
  ): Promise<CraftCallResult> {
    const result = await this.request(name, args, options.signal)
    return parseCallResult(result)
  }

  /** {@inheritDoc CraftTransport.close} */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closed = true
    this.fail(new CraftError('the Craft transport was closed', 'CRAFT_TRANSPORT_CLOSED'))
    this.process.terminate()
    this.closePromise = waitForSettlement(this.process.done, this.options.closeGraceMs)
    return this.closePromise
  }

  /**
   * Send one request and resolve its result.
   * @param method - app wire method.
   * @param params - JSON arguments.
   * @param signal - caller cancellation; aborts by killing the child tree.
   * @returns the raw JSON-RPC result value.
   */
  private request(
    method: string,
    params: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed || this.process.stdin === undefined) {
      return Promise.reject(new CraftError(
        `the Craft transport is closed; cannot call "${method}"`,
        'CRAFT_TRANSPORT_CLOSED',
      ))
    }
    if (signal?.aborted === true) {
      return Promise.reject(closedByAbort(method))
    }
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new CraftError(
          `Craft tool "${method}" timed out after ${String(this.options.requestTimeoutMs)}ms`,
          'CRAFT_TRANSPORT_TIMEOUT',
        ))
      }, this.options.requestTimeoutMs)
      const onAbort = (): void => {
        this.fail(closedByAbort(method))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        dropAbort: () => signal?.removeEventListener('abort', onAbort),
      })
      try {
        this.process.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      } catch (error: unknown) {
        this.pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Append one stdout chunk and drain every complete line.
   * @param chunk - decoded stdout text (a chunk may split a line).
   */
  private receive(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim() !== '') this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
  }

  /**
   * Handle one complete stdout line. Non-JSON diagnostics are ignored;
   * unknown ids are ignored because they cannot belong to this transport.
   * @param line - one line without its newline.
   */
  private handleLine(line: string): void {
    let decoded: unknown
    try {
      decoded = JSON.parse(line)
    } catch {
      this.options.warn?.(`craft-local: ignored a non-JSON app output line: ${line.slice(0, 200)}`)
      return
    }
    if (!isRecord(decoded)) return
    const envelope = decoded as RpcEnvelope
    if (typeof envelope.id !== 'number') return
    const pending = this.pending.get(envelope.id)
    if (pending === undefined) return
    this.pending.delete(envelope.id)
    clearTimeout(pending.timer)
    pending.dropAbort()
    if (envelope.error !== undefined) {
      pending.reject(new CraftError(
        `the Craft app rejected the request: ${errorMessage(envelope.error)}`,
        'CRAFT_APP_ERROR',
      ))
      return
    }
    pending.resolve(envelope.result)
  }

  /** Reject every in-flight request and stop accepting new ones. */
  private fail(error: CraftError): void {
    this.closed = true
    this.process.terminate()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.dropAbort()
      pending.reject(error)
    }
    this.pending.clear()
  }
}

/**
 * Validate one advertised tool descriptor.
 * @param value - untrusted catalog entry.
 * @param index - position used in the diagnostic.
 * @returns the descriptor.
 */
function parseToolDescriptor(value: unknown, index: number): CraftToolDescriptor {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim() === '') {
    throw new CraftError(`the Craft app advertised an invalid tool at index ${String(index)}`, 'CRAFT_APP_ERROR')
  }
  const description = typeof value.description === 'string' ? value.description : ''
  const inputSchema = isRecord(value.inputSchema) ? value.inputSchema : { type: 'object' }
  return { name: value.name, description, inputSchema }
}

/**
 * Validate one app result.
 * @param value - untrusted JSON-RPC result.
 * @returns the harness projection.
 */
function parseCallResult(value: unknown): CraftCallResult {
  if (!isRecord(value)) {
    throw new CraftError('the Craft app returned a non-object result', 'CRAFT_APP_ERROR')
  }
  const content = value.content
  if (!Array.isArray(content) || !content.every(isRecord)) {
    throw new CraftError('the Craft app returned a result without a content block array', 'CRAFT_APP_ERROR')
  }
  const artifacts = value.artifacts
  if (artifacts !== undefined && (!Array.isArray(artifacts) || !artifacts.every(entry => typeof entry === 'string'))) {
    throw new CraftError('the Craft app returned artifact paths that are not strings', 'CRAFT_APP_ERROR')
  }
  return {
    content,
    ...artifacts === undefined ? {} : { artifacts },
    ...value.isError === true ? { isError: true } : {},
  }
}

/** Extraction of one human-readable JSON-RPC error message. */
function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.message === 'string') return value.message
  return JSON.stringify(value)
}

/** Abort failure that also terminates the child tree. */
function closedByAbort(method: string): CraftError {
  return new CraftError(`Craft tool "${method}" was canceled`, 'CRAFT_TRANSPORT_CLOSED')
}

/**
 * Wait for process settlement, bounded by a close grace.
 * @param done - process settlement promise.
 * @param closeGraceMs - maximum wait.
 */
async function waitForSettlement(
  done: Promise<unknown>,
  closeGraceMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, closeGraceMs)
  })
  try {
    await Promise.race([done.then(() => undefined, () => undefined), grace])
  } finally {
    clearTimeout(timer)
  }
}

/** Narrow one untrusted value to a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

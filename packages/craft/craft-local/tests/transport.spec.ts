import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { CraftError } from '@greeneek/gnk-craft'
import { JsonRpcCraftTransport } from '../src/transport.ts'
import type { CraftTransportOptions } from '../src/transport.ts'

const baseOptions: CraftTransportOptions = {
  listMethod: 'command_list',
  registryMethod: 'engine.commands',
  requestTimeoutMs: 200,
  closeGraceMs: 5,
}

interface FakeProcess {
  readonly process: {
    stdin: PassThrough
    stdout: PassThrough
    done: Promise<{ exitCode: number | null; signal: string | null }>
    terminate: () => void
  }
  readonly terminate: ReturnType<typeof vi.fn>
  readonly writes: string[]
  push(text: string | Buffer): void
  settle(): void
  fail(error: Error): void
}

type Responder = (request: { id: number; method: string; params: unknown }, respond: (body: unknown) => void) => void

type WireRequest = Parameters<Responder>[0]

/**
 * Build a fake app process. `responder` receives each parsed request and may
 * write arbitrary bytes (or nothing) back.
 */
function createProcess(
  responder?: Responder,
  options: { readonly onTerminate?: () => void } = {},
): FakeProcess {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const writes: string[] = []
  let settle!: (value: { exitCode: number | null; signal: string | null }) => void
  let reject!: (error: Error) => void
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve, rejectDone) => {
    settle = resolve
    reject = rejectDone
  })
  let buffer = ''
  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      writes.push(line)
      responder?.(JSON.parse(line) as WireRequest, (body) => {
        stdout.write(`${JSON.stringify(body)}\n`)
      })
      index = buffer.indexOf('\n')
    }
  })
  const terminate = vi.fn(() => {
    options.onTerminate?.()
  })
  return {
    process: { stdin, stdout, done, terminate: () => { terminate() } },
    terminate,
    writes,
    push(text) {
      stdout.write(text)
    },
    settle() {
      settle({ exitCode: 0, signal: null })
    },
    fail(error) {
      reject(error)
    },
  }
}

/** One successful JSON-RPC response. */
function success(id: number, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result }
}

/** One JSON-RPC error response. */
function failure(id: number, error: unknown): unknown {
  return { jsonrpc: '2.0', id, error }
}

/** Wait one macrotask so piped writes reach listeners. */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('JsonRpcCraftTransport', () => {
  it('performs the MCP handshake and projects tool calls', async () => {
    const app = createProcess((request, respond) => {
      if (request.method === 'initialize') {
        respond(success(request.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'app', version: '1' } }))
        return
      }
      if (request.method === 'tools/list') {
        respond(success(request.id, { tools: [{ name: 'doc_create_multiple', description: 'Create', inputSchema: { type: 'object' } }] }))
        return
      }
      if (request.method === 'tools/call') {
        respond(success(request.id, {
          content: [{ type: 'text', text: '{"path":"C:\\out\\cv.pdf"}' }],
          structuredContent: { path: 'C:\out\cv.pdf', bytes: 3 },
        }))
      }
    })
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, protocol: 'mcp', registryMethod: null })

    expect(await transport.listTools()).toEqual([{ name: 'doc_create_multiple', description: 'Create', inputSchema: { type: 'object' } }])
    expect(app.writes.some(line => line.includes('notifications/initialized'))).toBe(true)
    const result = await transport.callTool('doc_create_multiple', {}, { signal: new AbortController().signal })
    expect(result.artifacts).toEqual(['C:\out\cv.pdf'])
    expect(result.content[0]).toMatchObject({ type: 'text' })
    await transport.close()
  })

  it('requires piped stdin and stdout', () => {
    const done = Promise.resolve({ exitCode: 0, signal: null })
    expect(() => new JsonRpcCraftTransport(
      { stdin: undefined, stdout: undefined, done, terminate: () => {} },
      baseOptions,
    )).toThrow(CraftError)
    expect(() => new JsonRpcCraftTransport(
      { stdin: new PassThrough(), stdout: undefined, done, terminate: () => {} },
      baseOptions,
    )).toThrow(/piped stdin and stdout/)
  })

  it('reads an MCP registry and tolerates structured-only results', async () => {
    let call = 0
    const app = createProcess((request, respond) => {
      if (request.method === 'initialize') { respond(success(request.id, { protocolVersion: '2024-11-05' })); return }
      if (request.method === 'tools/list') { respond(success(request.id, { tools: [] })); return }
      if (request.method === 'tools/call') {
        call += 1
        respond(success(request.id, call === 1
          ? {
            structuredContent: {
              files: [{ path: String.raw`\\?\C:\out\a.pdf` }],
            },
            isError: true,
          }
          : { content: [{ type: 'image', data: 'x' }, { type: 'text', text: 'not json' }] }))
      }
    })
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, protocol: 'mcp', registryMethod: null })

    await expect(transport.readCommandRegistry()).resolves.toEqual({ tools: [] })
    const first = await transport.callTool('x', {}, { signal: new AbortController().signal })
    expect(first).toMatchObject({ isError: true, artifacts: [String.raw`C:\out\a.pdf`] })
    expect(first.content[0]).toMatchObject({ type: 'text' })
    const second = await transport.callTool('y', {}, { signal: new AbortController().signal })
    expect(second.artifacts).toBeUndefined()
    await transport.close()
  })

  it('rejects malformed MCP results', async () => {
    let call = 0
    const app = createProcess((request, respond) => {
      if (request.method === 'initialize') { respond(success(request.id, { protocolVersion: '2024-11-05' })); return }
      if (request.method === 'notifications/initialized') return
      call += 1
      respond(call === 1 ? { jsonrpc: '2.0', id: request.id, result: 42 } : success(request.id, {}))
    })
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, protocol: 'mcp', registryMethod: null })
    await expect(transport.callTool('x', {}, { signal: new AbortController().signal })).rejects.toThrow('non-object MCP result')
    await expect(transport.callTool('y', {}, { signal: new AbortController().signal })).rejects.toThrow('no MCP content')
    await transport.close()
  })

  it('lists tools and fills safe defaults for omitted fields', async () => {
    const app = createProcess((request, respond) => {
      respond(success(request.id, {
        tools: [
          { name: 'render_preview', description: 'Render a preview', inputSchema: { type: 'object' } },
          { name: 'screenshot' },
        ],
      }))
    })
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)

    const tools = await transport.listTools()

    expect(tools).toEqual([
      { name: 'render_preview', description: 'Render a preview', inputSchema: { type: 'object' } },
      { name: 'screenshot', description: '', inputSchema: { type: 'object' } },
    ])
    expect(JSON.parse(app.writes[0] as string)).toMatchObject({ method: 'command_list', params: {} })
  })

  it('reads the raw serve-shaped command registry without an MCP tools envelope', async () => {
    const registry = { commands: [{ id: 'convert', schema: { type: 'object' } }] }
    const app = createProcess((request, respond) => {
      respond({ id: request.id, ok: true, result: registry })
    })
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)

    await expect(transport.readCommandRegistry()).resolves.toEqual(registry)
    expect(JSON.parse(app.writes[0] as string)).toMatchObject({ method: 'engine.commands', params: {} })
  })

  it('rejects a registry read when no method was observed', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, registryMethod: null })
    await expect(transport.readCommandRegistry()).rejects.toThrow('no observed command-registry method')
    expect(app.writes).toEqual([])
  })

  it('rejects a catalog response without a tools array', async () => {
    const app = createProcess((request, respond) => {
      respond(success(request.id, {}))
    })
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    await expect(transport.listTools()).rejects.toThrow(/no tool catalog/)

    const nonObject = createProcess((request, respond) => {
      respond(success(request.id, null))
    })
    await expect(new JsonRpcCraftTransport(nonObject.process, baseOptions).listTools())
      .rejects.toThrow(/no tool catalog/)
  })

  it('rejects catalog entries that are not named tools', async () => {
    const app = createProcess((request, respond) => {
      respond(success(request.id, { tools: [null] }))
    })
    await expect(new JsonRpcCraftTransport(app.process, baseOptions).listTools())
      .rejects.toThrow(/invalid tool at index 0/)

    const emptyName = createProcess((request, respond) => {
      respond(success(request.id, { tools: [{ name: '   ' }] }))
    })
    await expect(new JsonRpcCraftTransport(emptyName.process, baseOptions).listTools())
      .rejects.toThrow(/invalid tool at index 0/)
  })

  it('calls a tool with its raw name and projects content, artifacts, and isError', async () => {
    const app = createProcess((request, respond) => {
      expect(request.method).toBe('render_preview')
      expect(request.params).toEqual({ document: 'a.psd' })
      respond(success(request.id, {
        content: [{ type: 'text', text: 'rendered' }],
        artifacts: ['out/preview.png'],
        isError: true,
      }))
    })
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)

    const result = await transport.callTool(
      'render_preview',
      { document: 'a.psd' },
      { signal: new AbortController().signal },
    )

    expect(result).toEqual({
      content: [{ type: 'text', text: 'rendered' }],
      artifacts: ['out/preview.png'],
      isError: true,
    })
  })

  it('omits optional result fields that the app did not report', async () => {
    const app = createProcess((request, respond) => {
      respond(success(request.id, { content: [] }))
    })
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)

    await expect(transport.callTool('x', {}, { signal: new AbortController().signal }))
      .resolves.toEqual({ content: [] })
  })

  it('rejects malformed result shapes', async () => {
    const nonObject = createProcess((request, respond) => {
      respond(success(request.id, null))
    })
    await expect(new JsonRpcCraftTransport(nonObject.process, baseOptions).callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/non-object result/)

    const noContent = createProcess((request, respond) => {
      respond(success(request.id, { content: 'text' }))
    })
    await expect(new JsonRpcCraftTransport(noContent.process, baseOptions).callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/content block array/)

    const badArtifacts = createProcess((request, respond) => {
      respond(success(request.id, { content: [], artifacts: [1] }))
    })
    await expect(new JsonRpcCraftTransport(badArtifacts.process, baseOptions).callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/artifact paths that are not strings/)
  })

  it('reassembles a response split across two stdout chunks', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    const pending = transport.listTools()
    await tick()
    const request = JSON.parse(app.writes[0] as string) as WireRequest
    const line = `${JSON.stringify(success(request.id, { tools: [{ name: 'split_ok' }] }))}\n`
    const middle = line.indexOf('"tools"')
    app.push(line.slice(0, middle))
    await tick()
    app.push(line.slice(middle))

    await expect(pending).resolves.toEqual([{ name: 'split_ok', description: '', inputSchema: { type: 'object' } }])
  })

  it('accepts CRLF framing', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    const pending = transport.listTools()
    await tick()
    const request = JSON.parse(app.writes[0] as string) as WireRequest
    app.push(`${JSON.stringify(success(request.id, { tools: [] }))}\r\n`)
    await expect(pending).resolves.toEqual([])
  })

  it('ignores blank, non-JSON, non-object, string-id, and unknown-id lines', async () => {
    const warn = vi.fn()
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, warn })
    const pending = transport.listTools()
    await tick()
    const request = JSON.parse(app.writes[0] as string) as WireRequest
    app.push('\n')
    app.push('plain app diagnostic\n')
    app.push('42\n')
    app.push('[1]\n')
    app.push(`${JSON.stringify({ id: '1', result: { tools: [] } })}\n`)
    app.push(`${JSON.stringify({ id: 99, result: { tools: [] } })}\n`)
    app.push(`${JSON.stringify(success(request.id, { tools: [] }))}\n`)

    await expect(pending).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-JSON app output'))
  })

  it('surfaces JSON-RPC errors with their message', async () => {
    const objectError = createProcess((request, respond) => {
      respond(failure(request.id, { message: 'boom' }))
    })
    await expect(new JsonRpcCraftTransport(objectError.process, baseOptions).callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/rejected the request: boom/)

    const stringError = createProcess((request, respond) => {
      respond(failure(request.id, 'plain failure'))
    })
    await expect(new JsonRpcCraftTransport(stringError.process, baseOptions).callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/plain failure/)

    const opaqueError = createProcess((request, respond) => {
      respond(failure(request.id, { data: 42 }))
    })
    await expect(new JsonRpcCraftTransport(opaqueError.process, baseOptions).callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/42/)
  })

  it('times out a request and terminates the child tree', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, requestTimeoutMs: 10 })

    await expect(transport.callTool('x', {}, { signal: new AbortController().signal }))
      .rejects.toThrow(/timed out after 10ms/)
    expect(app.terminate).toHaveBeenCalled()
  })

  it('rejects an already-aborted call without writing', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)

    await expect(transport.callTool('x', {}, { signal: AbortSignal.abort() }))
      .rejects.toThrow(/was canceled/)
    expect(app.writes).toEqual([])
  })

  it('cancels an in-flight call and terminates the child tree', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    const controller = new AbortController()

    const pending = transport.callTool('x', {}, { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toThrow(/was canceled/)
    expect(app.terminate).toHaveBeenCalled()
  })

  it('rejects in-flight calls when the process exits or fails to start', async () => {
    const exited = createProcess()
    const exitedTransport = new JsonRpcCraftTransport(exited.process, baseOptions)
    const exitedPending = exitedTransport.callTool('x', {}, { signal: new AbortController().signal })
    exited.settle()
    await expect(exitedPending).rejects.toThrow(/process exited/)

    const failed = createProcess()
    const failedTransport = new JsonRpcCraftTransport(failed.process, baseOptions)
    const failedPending = failedTransport.callTool('x', {}, { signal: new AbortController().signal })
    failed.fail(new Error('spawn failed'))
    await expect(failedPending).rejects.toThrow(/failed to start/)
  })

  it('rejects every request after close and returns one close promise', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    const first = transport.close()
    const second = transport.close()
    expect(first).toBe(second)
    await first
    await expect(transport.listTools()).rejects.toThrow(/transport is closed/)
    expect(app.terminate).toHaveBeenCalled()
  })

  it('rejects a pending call when closed', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    const pending = transport.callTool('x', {}, { signal: new AbortController().signal })
    const rejection = expect(pending).rejects.toThrow(/transport was closed/)
    await transport.close()
    await rejection
  })

  it('closes within the grace even when the process never settles', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, { ...baseOptions, closeGraceMs: 5 })
    const started = Date.now()
    await transport.close()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('closes after a process-start failure', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    app.fail(new Error('spawn failed'))

    await expect(transport.close()).resolves.toBeUndefined()
  })

  it('propagates a synchronous stdin write failure', async () => {
    const stdout = new PassThrough()
    const stdin = new Writable({
      write() {
        throw new Error('write failed')
      },
    })
    const transport = new JsonRpcCraftTransport({
      stdin,
      stdout,
      done: new Promise(() => {}),
      terminate: () => {},
    }, baseOptions)

    await expect(transport.listTools()).rejects.toThrow(/write failed/)
  })

  it('wraps a non-Error stdin write failure', async () => {
    const stdout = new PassThrough()
    const stdin = new Writable({
      write() {
        throw 'write exploded'
      },
    })
    const transport = new JsonRpcCraftTransport({
      stdin,
      stdout,
      done: new Promise(() => {}),
      terminate: () => {},
    }, baseOptions)

    await expect(transport.listTools()).rejects.toThrow(/write exploded/)
  })

  it('decodes a multibyte character split across chunks', async () => {
    const app = createProcess()
    const transport = new JsonRpcCraftTransport(app.process, baseOptions)
    const pending = transport.listTools()
    await tick()
    const request = JSON.parse(app.writes[0] as string) as WireRequest
    const payload = Buffer.from(`${JSON.stringify(success(request.id, { tools: [{ name: 'café' }] }))}\n`, 'utf8')
    const split = payload.indexOf(0xc3) + 1
    app.push(payload.subarray(0, split))
    await tick()
    app.push(payload.subarray(split))

    await expect(pending).resolves.toEqual([expect.objectContaining({ name: 'café' })])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import type { Readable } from 'node:stream'
import { PassThrough } from 'node:stream'
import { resolve } from 'node:path'
import { PtyController } from '../src/pty.ts'

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Portable fake terminal handle for Host-level PtyController tests. */
function fakeHandle() {
  const output = new PassThrough()
  const exited = Promise.withResolvers<{ exitCode: number | null; signal?: string }>()
  const written: string[] = []
  const resized: Array<[number, number]> = []
  const terminate = vi.fn(async () => { exited.resolve({ exitCode: 0 }) })
  return {
    handle: {
      pid: 42,
      output: output as Readable,
      done: exited.promise.then(o => ({ exitCode: o.exitCode ?? 0, signal: o.signal })),
      write: async (data: string) => { written.push(data) },
      resize: (cols: number, rows: number) => { resized.push([cols, rows]) },
      inspectForeground: async () => undefined,
      signalForeground: async () => 42,
      terminate,
    },
    written,
    resized,
    terminate,
    output,
  }
}

describe('PtyController workspace fence', () => {
  it('refuses a path outside every registered workspace', async () => {
    const ctx = new Context()
    roots.push(ctx)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const controller = new PtyController(ctx)
    await expect(controller.open({ path: '/outside', cols: 80, rows: 24 }))
      .rejects.toThrow('outside every workspace')
  })

  it('refuses operations on an unknown session', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const controller = new PtyController(ctx)
    await expect(controller.write({ id: 'missing', data: 'x' })).rejects.toThrow()
  })
})

describe('PtyController lifecycle over the subprocess seam', () => {
  it('opens, writes, resizes and closes one session without duplicate exits', async () => {
    const ctx = new Context()
    roots.push(ctx)
    ctx.provide('workspaceRegistry', { list: () => [{ path: '/work' }] } as never)
    const fake = fakeHandle()
    const spawn = vi.fn(async () => fake.handle)
    ctx.provide('subprocess', { spawnTerminal: spawn } as never)
    const controller = new PtyController(ctx)

    const info = await controller.open({ path: '/work', cols: 80, rows: 24 })
    expect(info).toEqual({ id: info.id, cwd: resolve('/work'), cols: 80, rows: 24 })
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: resolve('/work'), cols: 80, rows: 24, argv: [expect.any(String)] }))

    await controller.write({ id: info.id, data: 'echo hi\r' })
    expect(fake.written).toEqual(['echo hi\r'])

    controller.resize({ id: info.id, cols: 100, rows: 30 })
    expect(fake.resized).toEqual([[100, 30]])
    expect(controller.list()).toEqual([{ id: info.id, cwd: resolve('/work'), cols: 100, rows: 30 }])

    const exits: Array<number | null> = []
    const abort = new AbortController()
    const stream = controller.events({ id: info.id }, abort.signal)
    const reading = (async () => { for await (const frame of stream) if (frame.type === 'exit') exits.push(frame.exitCode) })()

    await controller.close({ id: info.id })
    expect(fake.terminate).toHaveBeenCalledOnce()
    expect(controller.list()).toEqual([])
    abort.abort()
    await reading
    expect(exits.length).toBeLessThanOrEqual(1)
  })
})

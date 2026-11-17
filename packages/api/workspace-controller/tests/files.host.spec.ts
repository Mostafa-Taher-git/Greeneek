import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { remoteErrorOf } from '@greeneek/gnk-typert-protocol'
import { FileBrowserController, FILE_LISTING_LIMIT, FILE_READ_LIMIT, setFileBrowserInternals } from '../src/files.ts'
import type { FileBrowserInternals } from '../src/files.ts'

const ROOT = process.platform === 'win32' ? 'C:\\Users\\u' : '/home/u'
const signal = new AbortController().signal

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Build a controller with scripted filesystem primitives. */
async function harness(io: Partial<FileBrowserInternals> = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const controller = new FileBrowserController(ctx)
  setFileBrowserInternals(ctx, {
    readdir: io.readdir ?? (async () => []),
    stat: io.stat ?? (async () => ({ isDirectory: () => false, size: 3 }) as never),
    readFile: io.readFile ?? (async () => Buffer.from('abc')),
  })
  return controller
}

describe('FileBrowserController', () => {
  it('lists a fully qualified directory with sorted rows and crumbs', async () => {
    const controller = await harness({
      readdir: async () => [
        { name: 'b.txt', isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'a', isDirectory: () => true, isSymbolicLink: () => false },
        { name: '.hidden', isDirectory: () => false, isSymbolicLink: () => false },
      ] as never,
    })
    await expect(controller.list(ROOT, signal)).resolves.toMatchObject({
      path: ROOT,
      entries: [
        { name: '.hidden', kind: 'file', hidden: true },
        { name: 'a', kind: 'directory', hidden: false },
        { name: 'b.txt', kind: 'file', hidden: false },
      ],
      truncated: false,
    })
  })

  it('caps the listing and flags truncation', async () => {
    const rows = Array.from({ length: FILE_LISTING_LIMIT + 2 }, (_, i) => ({
      name: `f${i}`, isDirectory: () => false, isSymbolicLink: () => false,
    }))
    const controller = await harness({ readdir: async () => rows as never })
    const result = await controller.list(ROOT, signal)
    expect(result.entries).toHaveLength(FILE_LISTING_LIMIT)
    expect(result.truncated).toBe(true)
  })

  it('refuses a relative path', async () => {
    const controller = await harness()
    expect(remoteErrorOf(await controller.list('relative/path', signal).catch((error: unknown) => error))).toMatchObject({
      code: 'gateway/bad-request',
    })
  })

  it('reads a bounded UTF-8 file and flags binary content', async () => {
    const controller = await harness({ readFile: async () => Buffer.from([0, 1, 2]) })
    await expect(controller.read(`${ROOT}/a.bin`, signal)).resolves.toMatchObject({ binary: true, text: '' })
  })

  it('refuses a file above the read cap', async () => {
    const controller = await harness({
      stat: async () => ({ isDirectory: () => false, size: FILE_READ_LIMIT + 1 }) as never,
    })
    const error: unknown = await controller.read(`${ROOT}/big`, signal).catch((reason: unknown) => reason)
    expect(remoteErrorOf(error)).toMatchObject({ code: 'files/too-large' })
  })

  it('propagates cancellation', async () => {
    const controller = await harness({ readdir: vi.fn(async () => []) })
    const aborted = AbortSignal.abort()
    await expect(controller.list(ROOT, aborted)).rejects.toThrow()
  })
})

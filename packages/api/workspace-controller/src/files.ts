/**
 * Host file-browsing Remotes: one bounded directory level and bounded text
 * reads over the host filesystem. The controller owns the fully-qualified-path
 * fence and the result caps; injection of the filesystem primitives keeps the
 * Host logic testable without a real workspace.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'
import { Context } from '@greeneek/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import type { FileBrowserEntry, FileBrowserListing, FileBrowserRead } from './types.ts'

/** Maximum entries in one listing level. */
export const FILE_LISTING_LIMIT = 1000
/** Maximum bytes of one text read. */
export const FILE_READ_LIMIT = 1_048_576

/** Injectable filesystem primitives; defaults are the host stdlib. */
export interface FileBrowserInternals {
  /** Read one directory level. */
  readdir: (path: string) => Promise<readonly import('node:fs').Dirent[]>
  /** Stat one path (used for the listing root). */
  stat: (path: string) => Promise<import('node:fs').Stats>
  /** Read one file. */
  readFile: (path: string) => Promise<Buffer>
}

/** Host service backing the generated `ctx.remote.files` namespace. */
export class FileBrowserController extends TypertRemoteService {
  static inject = []

  /** @param ctx - Host context; the filesystem seam is process-local. */
  constructor(ctx: Context) {
    super(ctx, 'fileBrowserController', { namespace: 'files' })
  }

  /** Resolve the injected primitives, defaulting to Node's stdlib. */
  private get io(): FileBrowserInternals {
    return (this.ctx as Context & { fileBrowserInternals?: FileBrowserInternals }).fileBrowserInternals
      ?? {
        readdir: async path => readdir(path, { withFileTypes: true }),
        stat,
        readFile,
      }
  }

  /**
   * List one directory level.
   * @param path - fully-qualified directory; absent means the host home.
   * @param signal - caller lifetime; an aborted call rejects before any read.
   * @returns the bounded, name-sorted listing with its ancestry crumbs.
   */
  @Remote('list')
  async list(path: string | undefined, signal: AbortSignal): Promise<FileBrowserListing> {
    signal.throwIfAborted()
    const target = qualified(path)
    const home = homedir()
    let entries: FileBrowserEntry[]
    let truncated = false
    try {
      const dirents = await this.io.readdir(target)
      signal.throwIfAborted()
      truncated = dirents.length > FILE_LISTING_LIMIT
      entries = dirents.slice(0, FILE_LISTING_LIMIT).map(dirent => ({
        name: dirent.name,
        path: join(target, dirent.name),
        kind: dirent.isDirectory() ? 'directory' : 'file',
        hidden: dirent.name.startsWith('.'),
      }))
      entries.sort((a, b) => a.name.localeCompare(b.name))
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw new RemoteError('files/unreadable', `cannot list ${target}: ${messageOf(error)}`, { path: target }, { cause: error })
    }
    return { path: target, home, crumbs: ancestry(target), entries, truncated }
  }

  /**
   * Read a bounded UTF-8 text file.
   * @param path - fully-qualified file path.
   * @param signal - caller lifetime.
   * @returns the text, or `binary: true` when the file cannot be decoded as text.
   */
  @Remote('read')
  async read(path: string, signal: AbortSignal): Promise<FileBrowserRead> {
    signal.throwIfAborted()
    const target = qualified(path)
    try {
      const info = await this.io.stat(target)
      signal.throwIfAborted()
      if (info.isDirectory()) throw new RemoteError('files/unreadable', `${target} is a directory`, { path: target })
      if (info.size > FILE_READ_LIMIT) {
        throw new RemoteError('files/too-large', `${target} exceeds the ${FILE_READ_LIMIT} byte read cap`, { path: target })
      }
      const buffer = await this.io.readFile(target)
      signal.throwIfAborted()
      if (buffer.includes(0)) return { path: target, text: '', binary: true, size: buffer.byteLength }
      return { path: target, text: buffer.toString('utf8'), binary: false, size: buffer.byteLength }
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      signal.throwIfAborted()
      throw new RemoteError('files/unreadable', `cannot read ${target}: ${messageOf(error)}`, { path: target }, { cause: error })
    }
  }
}

/**
 * Resolve a caller path only when it is fully qualified on this platform.
 * @param path - caller-supplied path, absent for the host home.
 * @returns the resolved absolute path.
 */
function qualified(path: string | undefined): string {
  const value = path ?? homedir()
  const isQualified = process.platform === 'win32'
    ? win32.isAbsolute(value) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(value)
    : posix.isAbsolute(value)
  if (!isQualified) {
    throw new RemoteError('gateway/bad-request', `not a fully qualified path: ${value}`, {
      issues: [{ message: 'a fully qualified path is required' }],
    })
  }
  return resolve(value)
}

/** Ancestor crumbs from the filesystem root to `target` inclusive. */
function ancestry(target: string): FileBrowserEntry[] {
  const crumbs: FileBrowserEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, kind: 'directory', hidden: false })
    if (parent === current) return crumbs
    current = parent
  }
}

/** Message of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

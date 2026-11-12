/**
 * Read one Session's durable log as Markdown.
 *
 * The export reads the same archive the Session download offers, so the copy
 * and the ZIP always agree: the durable log is the transcript's source, and
 * the archive is what the Host already streams for that Session tree.
 */
import type { SessionEvent, SessionId } from '@greeneek/gnk-session/types'
import { sessionMarkdown, type SessionMarkdownLabels } from './markdown.ts'

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** The archive entry holding the Session's own log. */
const LOG_ENTRY = 'session.jsonl'

/** The ZIP record signatures the reader needs. */
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP_CENTRAL_HEADER = 0x02014b50

/** The ZIP compression methods this reader understands. */
const ZIP_STORED = 0
const ZIP_DEFLATED = 8

/**
 * Read one stored entry from a ZIP archive.
 *
 * The Host streams the archive, so a local file header carries no sizes:
 * they follow the data in a descriptor, and the central directory at the end
 * of the archive holds the real ones. The reader therefore walks the central
 * directory and reads the data from the local header it points at.
 *
 * The browser's own inflate does the work: `DecompressionStream` reads raw
 * deflate, which is exactly what a ZIP entry carries. Nothing outside the
 * browser platform is needed, so the browser half carries no archive library.
 * @param archive - the archive bytes.
 * @param wanted - the entry's file name.
 * @returns the entry's bytes, or undefined when the archive has no such entry.
 */
export async function readZipEntry(
  archive: Uint8Array,
  wanted: string,
): Promise<Uint8Array | undefined> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let end = -1
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      end = offset
      break
    }
  }
  if (end < 0) return undefined
  const entries = view.getUint16(end + 10, true)
  let cursor = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_HEADER) return undefined
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(archive.slice(cursor + 46, cursor + 46 + nameLength))
    if (name === wanted) {
      // The local header repeats the name and extra lengths; the data follows them.
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const data = archive.slice(start, start + compressedSize)
      if (method === ZIP_STORED) return data
      if (method !== ZIP_DEFLATED) {
        throw new Error(`unsupported ZIP compression method ${method}`)
      }
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return undefined
}

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://gnk.internal'
}

/** Parse the durable log lines into events, skipping lines that are not events. */
function parseEvents(log: string): { events: SessionEvent[]; cwd: string | undefined } {
  const events: SessionEvent[] = []
  let cwd: string | undefined
  for (const line of log.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // A malformed line is not a transcript entry; the rest of the log still is.
      continue
    }
    if (parsed === null || typeof parsed !== 'object') continue
    const record = parsed as { type?: unknown; data?: { cwd?: unknown } }
    if (record.type === 'session') {
      // The log's first line is the Session header, not an event.
      cwd = typeof record.data?.cwd === 'string' ? record.data.cwd : undefined
      continue
    }
    if (typeof record.type === 'string') {
      events.push(parsed as SessionEvent)
    }
  }
  return { events, cwd }
}

/**
 * Read one Session's durable log and render it as Markdown.
 * @param fetcher - HTTP carrier used to read the host-streamed archive.
 * @param sessionId - root Session whose log becomes the document.
 * @param title - the Session's display title, which names the document.
 * @param labels - the headings the document uses.
 * @param signal - abort signal for the archive read.
 * @returns the Markdown transcript of the Session.
 */
export async function fetchSessionMarkdown(
  fetcher: Fetch,
  sessionId: SessionId,
  title: string,
  labels: SessionMarkdownLabels,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL('/api/session.export', hostBase())
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('includeDescendants', 'false')
  const response = await fetcher(url, signal === undefined ? {} : { signal })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Export failed: HTTP ${response.status}${detail === '' ? '' : ` ${detail}`}`)
  }
  const archive = new Uint8Array(await response.arrayBuffer())
  const log = await readZipEntry(archive, LOG_ENTRY)
  if (log === undefined) {
    throw new Error(`Export archive has no ${LOG_ENTRY}`)
  }
  const { events, cwd } = parseEvents(new TextDecoder().decode(log))
  return sessionMarkdown(events, { title, ...(cwd === undefined ? {} : { cwd }) }, labels)
}

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

/** The local file header signature every ZIP entry starts with. */
const ZIP_LOCAL_HEADER = 0x04034b50

/** The ZIP compression methods this reader understands. */
const ZIP_STORED = 0
const ZIP_DEFLATED = 8

/**
 * Read one stored entry from a ZIP archive.
 *
 * The browser's own inflate does the work: `DecompressionStream` reads raw
 * deflate, which is exactly what a ZIP entry carries. Nothing outside the
 * browser platform is needed, so the browser half carries no archive library.
 * @param archive - the archive bytes.
 * @param wanted - the entry's file name.
 * @returns the entry's bytes, or undefined when the archive has no such entry.
 */
async function readZipEntry(
  archive: Uint8Array,
  wanted: string,
): Promise<Uint8Array | undefined> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  if (view.getUint32(0, true) !== ZIP_LOCAL_HEADER) return undefined
  const method = view.getUint16(8, true)
  const compressedSize = view.getUint32(18, true)
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const name = new TextDecoder().decode(archive.slice(30, 30 + nameLength))
  if (name !== wanted) return undefined
  const start = 30 + nameLength + extraLength
  const data = archive.slice(start, start + compressedSize)
  if (method === ZIP_STORED) return data
  if (method !== ZIP_DEFLATED) {
    throw new Error(`unsupported ZIP compression method ${method}`)
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
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

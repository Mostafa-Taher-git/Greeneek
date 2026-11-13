import { describe, expect, it } from 'vitest'
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate'
import { readZipEntry } from '../src/client/markdown-source.ts'

/**
 * Build the archive the Host streams: the local file header carries no sizes
 * (they follow the data in a descriptor), and the central directory holds the
 * real ones.
 */
async function streamedZip(name: string, content: string, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  await new Promise<void>((resolve, reject) => {
    const archive = new Zip((error, data, final) => {
      if (error !== undefined && error !== null) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (data !== undefined && data.byteLength > 0) chunks.push(data)
      if (final) resolve()
    })
    const entry = new ZipDeflate(name, { level })
    archive.add(entry)
    entry.push(strToU8(content), true)
    archive.end()
  })
  const archive = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    archive.set(chunk, offset)
    offset += chunk.byteLength
  }
  return archive
}

describe('readZipEntry', () => {
  it('reads an entry out of the streamed archive the Host serves', async () => {
    const archive = await streamedZip('session.jsonl', '{"type":"session"}\n')
    const entry = await readZipEntry(archive, 'session.jsonl')
    expect(entry).toBeDefined()
    expect(new TextDecoder().decode(entry)).toBe('{"type":"session"}\n')
  })

  it('reports an archive without the wanted entry', async () => {
    const archive = await streamedZip('other.jsonl', 'x')
    expect(await readZipEntry(archive, 'session.jsonl')).toBeUndefined()
  })

  it('reports bytes that are not an archive', async () => {
    expect(await readZipEntry(new Uint8Array([1, 2, 3, 4]), 'session.jsonl')).toBeUndefined()
  })

  it('reads an entry stored without compression', async () => {
    const chunks: Uint8Array[] = []
    await new Promise<void>((resolve, reject) => {
      const archive = new Zip((error, data, final) => {
        if (error !== undefined && error !== null) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (data !== undefined && data.byteLength > 0) chunks.push(data)
        if (final) resolve()
      })
      const entry = new ZipPassThrough('session.jsonl')
      archive.add(entry)
      entry.push(strToU8('x'), true)
      archive.end()
    })
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const entry = await readZipEntry(bytes, 'session.jsonl')
    expect(new TextDecoder().decode(entry)).toBe('x')
  })

  it('keeps the archive reader free of an archive library', () => {
    expect(typeof strToU8).toBe('function')
  })
})

import { describe, expect, it } from 'vitest'
import { buildCapabilityMatrix, CapabilityCache, hashCapabilityMatrix } from '../src/capability.ts'
import { hashCommandRegistry } from '../src/registry.ts'

describe('buildCapabilityMatrix', () => {
  it('projects an MCP tools-list registry', () => {
    const raw = {
      tools: [
        { name: 'doc_create_multiple', description: 'Create', inputSchema: { type: 'object' } },
        { name: 'doc_info' },
      ],
    }
    const matrix = buildCapabilityMatrix('pdfcraft', raw)
    expect(matrix.tools).toEqual([
      { name: 'doc_create_multiple', description: 'Create', inputSchema: { type: 'object' } },
      { name: 'doc_info', description: '', inputSchema: { type: 'object' } },
    ])
    expect(matrix.method).toBe('tools-list')
    expect(matrix.hash).toBe(hashCommandRegistry(raw))
  })

  it('projects a serve engine.commands registry by id', () => {
    const raw = {
      commands: [
        { id: 'convert', input: { type: 'object' } },
        { id: 'engine.execute', description: 'Run', schema: { type: 'object', properties: { cmd: {} } } },
      ],
    }
    const matrix = buildCapabilityMatrix('photocraft', raw)
    expect(matrix.tools).toEqual([
      { name: 'convert', description: '', inputSchema: { type: 'object' } },
      { name: 'engine.execute', description: 'Run', inputSchema: { type: 'object', properties: { cmd: {} } } },
    ])
    expect(matrix.method).toBe('engine-commands')
  })

  it('projects a bare command-list array', () => {
    const matrix = buildCapabilityMatrix('figcraft', [{ id: 'export', inputSchema: { type: 'object' } }])
    expect(matrix.tools).toEqual([{ name: 'export', description: '', inputSchema: { type: 'object' } }])
    expect(matrix.method).toBe('command-list')
  })

  it('allows an empty registry to project to no tools', () => {
    expect(buildCapabilityMatrix('pdfcraft', { tools: [] }).tools).toEqual([])
  })

  it('rejects a registry without a tools or commands array', () => {
    expect(() => buildCapabilityMatrix('pdfcraft', {})).toThrow(/carries no tools or commands array/)
    expect(() => buildCapabilityMatrix('pdfcraft', null)).toThrow(/is not a JSON value/)
    expect(() => buildCapabilityMatrix('pdfcraft', 42)).toThrow(/is not a JSON value/)
  })

  it('rejects entries without a usable name', () => {
    expect(() => buildCapabilityMatrix('pdfcraft', { tools: [null] })).toThrow(/invalid command at index 0/)
    expect(() => buildCapabilityMatrix('pdfcraft', { commands: [{ input: {} }] })).toThrow(/invalid command at index 0/)
  })
})

describe('CapabilityCache', () => {
  it('treats the first hash as baseline and never as drift', () => {
    const cache = new CapabilityCache()
    expect(cache.remember('photocraft', 'sha256:a')).toBe(false)
    expect(cache.remember('photocraft', 'sha256:a')).toBe(false)
    expect(cache.baselineHash('photocraft')).toBe('sha256:a')
    expect(cache.lastObserved('photocraft')).toBe('sha256:a')
  })

  it('flags a later hash that disagrees with the baseline', () => {
    const cache = new CapabilityCache()
    cache.remember('photocraft', 'sha256:a')
    expect(cache.remember('photocraft', 'sha256:b')).toBe(true)
    expect(cache.drifted('photocraft', 'sha256:b')).toBe(true)
    expect(cache.drifted('photocraft', 'sha256:a')).toBe(false)
    expect(cache.driftedApps()).toEqual(['photocraft'])
  })

  it('recovers when a later hash returns to the baseline', () => {
    const cache = new CapabilityCache()
    cache.remember('pdfcraft', 'sha256:a')
    cache.remember('pdfcraft', 'sha256:b')
    cache.remember('pdfcraft', 'sha256:a')
    expect(cache.driftedApps()).toEqual([])
  })

  it('keeps baselines per app', () => {
    const cache = new CapabilityCache()
    cache.remember('photocraft', 'sha256:a')
    cache.remember('pdfcraft', 'sha256:b')
    expect(cache.baselineHash('pdfcraft')).toBe('sha256:b')
    expect(cache.baselineHash('figcraft')).toBeUndefined()
  })
})

describe('hashCapabilityMatrix', () => {
  it('matches the registry drift hash', () => {
    const raw = { commands: [{ id: 'convert' }] }
    expect(hashCapabilityMatrix(raw)).toBe(hashCommandRegistry(raw))
  })
})

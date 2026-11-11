import { describe, expect, it } from 'vitest'
import {
  collectClientReferences,
  collectHostReferences,
  extractReferences,
  renderReferences,
  writeReferences,
} from './gen-tsconfig-references.ts'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

describe('generated aggregate references', () => {
  it('collects every vendor package in the host aggregate', () => {
    const refs = collectHostReferences(root)
    expect(refs).toContain('./vendor/cordis')
    expect(refs).toContain('./apps/cli')
    expect(refs).toContain('./native/landlock-run/packages/entry')
  })

  it('keeps client packages out of the host aggregate and widens the client aggregate by direct workspace dependencies', () => {
    const host = collectHostReferences(root)
    const client = collectClientReferences(root)
    expect(host.some(ref => ref.startsWith('./packages/client/'))).toBe(false)
    expect(client).toContain('./apps/web')
    // Client tests import shared leaves directly (typert-registry is the
    // motivating case: a gateway client spec imports it, but no client leaf
    // references it), so direct workspace dependencies of client-face
    // packages are client references too.
    expect(client).toContain('./packages/typert/registry')
  })

  it('includes a host root config when the package also declares a client face', () => {
    expect(collectHostReferences(root)).toContain('./packages/preset/agent-presets')
    expect(collectClientReferences(root)).toContain('./packages/preset/agent-presets/tsconfig.client.json')
  })

  it('extracts and rewrites only the references block', () => {
    const text = [
      '{',
      '  // outer comment kept',
      '  "references": [',
      '    { "path": "./stale" }',
      '  ]',
      '}',
      '',
    ].join('\n')
    expect(extractReferences(text)).toEqual(['./stale'])
    const next = writeReferences(text, ['./a', './b'])
    expect(next).toContain('  // outer comment kept')
    expect(next).toContain('{ "path": "./a" }')
    expect(next).not.toContain('./stale')
  })

  it('renders one entry per line', () => {
    expect(renderReferences(['./a', './b'])).toBe('    { "path": "./a" },\n    { "path": "./b" }')
  })
})

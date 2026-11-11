import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectVendorDrift, parseModificationEntries, patchFileName, vendorTreeHash } from './verify-vendor-drift.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(root: string, file: string, content: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

const README = [
  '# Vendored',
  '## Local modifications',
  '',
  '1. **`hmr/src/index.ts`**: removed locales.',
  '2. **`cordis/src/fiber.ts` lifecycle hardening**: closes gaps.',
  '',
  '## Sync procedure',
  '',
  'Steps.',
].join('\n')

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-vendor-drift-'))
  roots.push(root)
  writeFile(root, 'vendor/README.md', README)
  writeFile(root, 'vendor/hmr/package.json', `${JSON.stringify({ name: '@greeneek/cordis-plugin-hmr' }, null, 2)}\n`)
  writeFile(root, 'vendor/hmr/src/index.ts', 'export {}\n')
  return root
}

describe('vendor drift gate', () => {
  it('splits the numbered modification list', () => {
    const entries = parseModificationEntries(README)
    expect(entries.map(e => e.number)).toEqual([1, 2])
    expect(patchFileName(entries[0]!)).toBe('01-hmr-src-index-ts.patch')
  })

  it('fails when a patch file is missing', () => {
    const root = createRoot()
    expect(inspectVendorDrift(root).failures.some(f => f.includes('missing patch file'))).toBe(true)
  })

  it('fails when the tree changed without regenerating patches', () => {
    const root = createRoot()
    const hash = vendorTreeHash(root)
    writeFile(root, 'vendor/.patches/01-hmr-src-index-ts.patch', 'Modification 1: hmr/src/index.ts\nTree-hash: stale\n')
    writeFile(root, 'vendor/.patches/02-cordis-src-fiber-ts-lifecycle-hardening.patch', `Modification 2: cordis/src/fiber.ts lifecycle hardening\nTree-hash: ${hash}\n`)
    const report = inspectVendorDrift(root)
    expect(report.failures.some(f => f.includes('tree hash is stale'))).toBe(true)
  })
})

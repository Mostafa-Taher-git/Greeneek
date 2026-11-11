import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectLicenseInventory } from './verify-license-inventory.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(root: string, file: string, content: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-license-inventory-'))
  roots.push(root)
  writeFile(root, 'package.json', `${JSON.stringify({ name: '@greeneek/gnk-root', license: 'MIT' }, null, 2)}\n`)
  writeFile(root, 'LICENSE', 'MIT License\n')
  return root
}

const README_ROW = '| `cordis/` | `@greeneek/cordis` | `cordis` | 4.0.0 | https://github.com/cordiverse/cordis | `56b3d4f725681cf` |'

function addVendored(root: string, manifestLicense: string | undefined, licenseText: string | undefined): void {
  writeFile(root, 'vendor/README.md', ['# Vendored', README_ROW].join('\n'))
  const manifest: Record<string, unknown> = { name: '@greeneek/cordis' }
  if (manifestLicense !== undefined) manifest.license = manifestLicense
  writeFile(root, 'vendor/cordis/package.json', `${JSON.stringify(manifest, null, 2)}\n`)
  if (licenseText !== undefined) writeFile(root, 'vendor/cordis/LICENSE', licenseText)
}

describe('license inventory gate', () => {
  it('passes a complete MIT inventory', () => {
    const root = createRoot()
    addVendored(root, 'MIT', 'MIT License\n')
    expect(inspectLicenseInventory(root)).toEqual({ packageCount: 1, failures: [] })
  })

  it('fails when a vendored LICENSE file is missing', () => {
    const root = createRoot()
    addVendored(root, 'MIT', undefined)
    expect(inspectLicenseInventory(root).failures).toEqual([
      'vendor/cordis/LICENSE: vendored @greeneek/cordis must carry its upstream MIT LICENSE file.',
    ])
  })

  it('fails when the vendored manifest license is not MIT', () => {
    const root = createRoot()
    addVendored(root, 'BSD-3-Clause', 'MIT License\n')
    expect(inspectLicenseInventory(root).failures).toEqual([
      'vendor/cordis/package.json: @greeneek/cordis must declare "license": "MIT"; found "BSD-3-Clause".',
    ])
  })

  it('fails when the manifest table has no row for a vendored directory', () => {
    const root = createRoot()
    writeFile(root, 'vendor/README.md', ['# Vendored'].join('\n'))
    writeFile(root, 'vendor/cordis/package.json', `${JSON.stringify({ name: '@greeneek/cordis', license: 'MIT' }, null, 2)}\n`)
    writeFile(root, 'vendor/cordis/LICENSE', 'MIT License\n')
    expect(() => inspectLicenseInventory(root)).toThrow('parsed to zero rows')
  })
})

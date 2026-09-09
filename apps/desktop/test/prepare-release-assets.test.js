import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  prepareReleaseAssets,
  releaseAssetMappings,
} from '../scripts/prepare-release-assets.mjs'

const VERSION = '0.9.0'

function stageDist(names) {
  const dir = mkdtempSync(join(tmpdir(), 'greeneek-release-assets-'))
  for (const name of names) writeFileSync(join(dir, name), `bytes-of-${name}`)
  return dir
}

describe('prepare-release-assets', () => {
  it('aliases every versioned asset when the full matrix is present', () => {
    const sources = releaseAssetMappings(VERSION).map(([source]) => source)
    const dir = stageDist(sources)
    try {
      const aliases = prepareReleaseAssets({ distDir: dir, version: VERSION })
      assert.deepEqual(aliases, [
        'Greeneek-Desktop-latest-linux-amd64.deb',
        'Greeneek-Desktop-latest-linux-x86_64.AppImage',
        'Greeneek-Desktop-latest-windows-x64.exe',
        'Greeneek-Desktop-latest-windows-x64.zip',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('aliases one platform without failing on the other (per-runner dist)', () => {
    const dir = stageDist([
      `Greeneek-Desktop-${VERSION}-linux-amd64.deb`,
      `Greeneek-Desktop-${VERSION}-linux-x86_64.AppImage`,
    ])
    try {
      const aliases = prepareReleaseAssets({ distDir: dir, version: VERSION })
      assert.deepEqual(aliases, [
        'Greeneek-Desktop-latest-linux-amd64.deb',
        'Greeneek-Desktop-latest-linux-x86_64.AppImage',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loudly when the dist dir holds no release asset', () => {
    const dir = stageDist([])
    try {
      assert.throws(
        () => prepareReleaseAssets({ distDir: dir, version: VERSION }),
        /Missing release assets/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

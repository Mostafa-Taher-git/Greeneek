import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  parseDesktopVersion,
  prepareReleaseAssets,
  releaseAssetMappings,
  resolveDistDir,
  resolveReleaseTag,
} from '../scripts/prepare-release-assets.mjs'

const VERSION = '0.9.0'
const SCRIPT = fileURLToPath(new URL('../scripts/prepare-release-assets.mjs', import.meta.url))

function stageDist(names) {
  const dir = mkdtempSync(join(tmpdir(), 'greeneek-release-assets-'))
  for (const name of names) writeFileSync(join(dir, name), `bytes-of-${name}`)
  return dir
}

describe('resolveDistDir', () => {
  it('keeps the default inside the desktop package', () => {
    assert.equal(
      resolveDistDir('/repo/apps/desktop', undefined, '/repo'),
      join('/repo/apps/desktop', 'dist'),
    )
  })

  it('resolves a supplied relative path against the working directory', () => {
    assert.equal(
      resolveDistDir('/repo/apps/desktop', 'apps/desktop/.staging/app/dist', '/repo'),
      resolve('/repo', 'apps/desktop/.staging/app/dist'),
    )
  })

  it('keeps an absolute path as given', () => {
    const dir = stageDist([])
    try {
      assert.equal(resolveDistDir('/repo/apps/desktop', dir, '/somewhere'), dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

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
        (error) => error.message.startsWith(`Missing release assets in ${dir}:`),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('aliases from a repo-root-relative --dist, the way the release workflow calls it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'greeneek-release-cwd-'))
    const distDir = join(cwd, 'apps/desktop/.staging/app/dist')
    mkdirSync(distDir, { recursive: true })
    for (const name of releaseAssetMappings('0.9.1').map(([source]) => source)) {
      writeFileSync(join(distDir, name), `bytes-of-${name}`)
    }
    try {
      const result = spawnSync(
        process.execPath,
        [SCRIPT, '--dist', relative(cwd, distDir), '--tag', 'desktop-v0.9.1'],
        { cwd, encoding: 'utf8' },
      )
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Prepared stable release aliases/)
      assert.ok(existsSync(join(distDir, 'Greeneek-Desktop-latest-linux-amd64.deb')))
      assert.ok(existsSync(join(distDir, 'Greeneek-Desktop-latest-windows-x64.exe')))
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('does not treat GITHUB_REF_NAME=main as a release tag', () => {
    assert.equal(resolveReleaseTag(undefined, 'main'), '')
    assert.equal(resolveReleaseTag(undefined, `desktop-v${VERSION}`), `desktop-v${VERSION}`)
    assert.equal(resolveReleaseTag(`desktop-v${VERSION}`, 'main'), `desktop-v${VERSION}`)
    assert.equal(parseDesktopVersion(`desktop-v${VERSION}`), VERSION)
  })
})

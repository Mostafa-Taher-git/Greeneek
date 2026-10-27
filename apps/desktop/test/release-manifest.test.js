import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  listReleaseFiles,
  verifyReleaseManifest,
  writeReleaseManifest,
} from '../scripts/release-manifest.mjs'
import { parseDesktopVersion, resolveReleaseTag } from '../scripts/prepare-release-assets.mjs'

const VERSION = '0.3.7'
const TAG = `desktop-v${VERSION}`

function fixture(names = [
  `Greeneek-Desktop-${VERSION}-linux-amd64.deb`,
  `Greeneek-Desktop-${VERSION}-linux-x86_64.AppImage`,
  `Greeneek-Desktop-${VERSION}-windows-x64.exe`,
  `Greeneek-Desktop-${VERSION}-windows-x64.zip`,
  `Greeneek-Desktop-latest-windows-x64.exe`,
]) {
  const root = mkdtempSync(join(tmpdir(), 'greeneek-manifest-'))
  for (const name of names) writeFileSync(join(root, name), `bytes-of-${name}`)
  return root
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

describe('release tag resolution', () => {
  it('accepts an explicit tag over the environment', () => {
    assert.equal(resolveReleaseTag(TAG, 'main'), TAG)
  })

  it('ignores a branch name in GITHUB_REF_NAME', () => {
    assert.equal(resolveReleaseTag(undefined, 'main'), '')
    assert.equal(resolveReleaseTag('', 'main'), '')
  })

  it('accepts a tag-shaped GITHUB_REF_NAME', () => {
    assert.equal(resolveReleaseTag(undefined, TAG), TAG)
  })

  it('strips the desktop prefix from the version', () => {
    assert.equal(parseDesktopVersion(TAG), VERSION)
    assert.equal(parseDesktopVersion('v1.2.3'), 'v1.2.3')
  })
})

describe('release manifest', () => {
  it('writes checksums and a manifest that names every asset', async () => {
    const root = fixture()
    try {
      const manifest = await writeReleaseManifest({ root, tag: TAG, commit: 'abc123' })
      assert.equal(manifest.schemaVersion, 1)
      assert.equal(manifest.tag, TAG)
      assert.equal(manifest.version, VERSION)
      assert.equal(manifest.commit, 'abc123')
      assert.equal(manifest.assets.length, 5)
      assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/)

      const sums = readFileSync(join(root, 'SHA256SUMS'), 'utf8')
      const exe = `bytes-of-Greeneek-Desktop-${VERSION}-windows-x64.exe`
      assert.match(sums, new RegExp(`${sha256(exe)}  Greeneek-Desktop-${VERSION}-windows-x64\\.exe`))

      const written = JSON.parse(readFileSync(join(root, 'release-manifest.json'), 'utf8'))
      assert.deepEqual(written, manifest)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('verifies an unchanged set and rejects a changed byte', async () => {
    const root = fixture()
    try {
      await writeReleaseManifest({ root, tag: TAG, commit: 'abc123' })
      await verifyReleaseManifest({ root })

      appendFileSync(join(root, `Greeneek-Desktop-${VERSION}-windows-x64.exe`), 'tampered')
      await assert.rejects(() => verifyReleaseManifest({ root }), /verification failed/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a missing asset named by the manifest', async () => {
    const root = fixture()
    try {
      await writeReleaseManifest({ root, tag: TAG, commit: 'abc123' })
      rmSync(join(root, `Greeneek-Desktop-${VERSION}-linux-amd64.deb`))
      await assert.rejects(() => verifyReleaseManifest({ root }), /missing/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an empty asset', async () => {
    const root = fixture([
      `Greeneek-Desktop-${VERSION}-linux-amd64.deb`,
      `Greeneek-Desktop-${VERSION}-linux-x86_64.AppImage`,
      `Greeneek-Desktop-${VERSION}-windows-x64.exe`,
      `Greeneek-Desktop-${VERSION}-windows-x64.zip`,
    ])
    try {
      writeFileSync(join(root, `Greeneek-Desktop-${VERSION}-windows-x64.zip`), '')
      await assert.rejects(() => writeReleaseManifest({ root, tag: TAG, commit: 'abc123' }), /asset is empty/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails a full release when one platform is absent', async () => {
    const root = fixture([`Greeneek-Desktop-${VERSION}-linux-amd64.deb`])
    try {
      await assert.rejects(() => writeReleaseManifest({ root, tag: TAG, commit: 'abc123' }), /incomplete/)
      const manifest = await writeReleaseManifest({ root, tag: TAG, commit: 'abc123', requireAllPlatforms: false })
      assert.equal(manifest.assets.length, 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('excludes its own outputs and dotfiles from the asset list', async () => {
    const root = fixture([`Greeneek-Desktop-${VERSION}-windows-x64.exe`])
    try {
      writeFileSync(join(root, 'SHA256SUMS'), 'old')
      writeFileSync(join(root, 'release-manifest.json'), '{}')
      mkdirSync(join(root, '.hidden'))
      writeFileSync(join(root, '.hidden', 'ignored'), 'x')
      assert.deepEqual(listReleaseFiles(root).map(path => path.slice(root.length + 1)), [
        `Greeneek-Desktop-${VERSION}-windows-x64.exe`,
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

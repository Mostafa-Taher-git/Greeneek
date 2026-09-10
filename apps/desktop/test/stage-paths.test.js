import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { pathContainsSegment, soleStoreSource } from '../scripts/stage.mjs'

describe('pathContainsSegment', () => {
  it('matches posix workspace paths', () => {
    assert.equal(pathContainsSegment('/home/runner/work/Greeneek/Greeneek/packages/core/gnk', 'packages'), true)
    assert.equal(pathContainsSegment('/home/runner/work/Greeneek/Greeneek/vendor/cordis', 'vendor'), true)
    assert.equal(pathContainsSegment('/home/runner/work/Greeneek/Greeneek/node_modules/.pnpm/foo', 'node_modules/.pnpm'), true)
  })

  it('matches windows realpath output with backslashes', () => {
    assert.equal(pathContainsSegment('D:\\a\\Greeneek\\Greeneek\\packages\\core\\gnk', 'packages'), true)
    assert.equal(pathContainsSegment('D:\\a\\Greeneek\\Greeneek\\vendor\\cordis', 'vendor'), true)
    assert.equal(pathContainsSegment('D:\\a\\Greeneek\\Greeneek\\node_modules\\.pnpm\\foo', 'node_modules/.pnpm'), true)
  })

  it('rejects partial segment names on either separator', () => {
    assert.equal(pathContainsSegment('/repo/packages-backup/gnk', 'packages'), false)
    assert.equal(pathContainsSegment('D:\\repo\\packages-backup\\gnk', 'packages'), false)
    assert.equal(pathContainsSegment('/repo/apps/desktop', 'packages'), false)
  })
})

describe('soleStoreSource', () => {
  function fakeStore(entries) {
    const dir = mkdtempSync(join(tmpdir(), 'greeneek-store-'))
    for (const name of entries) {
      const pkgDir = join(dir, name, 'node_modules', '@opentelemetry', 'api-logs')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@opentelemetry/api-logs' }))
    }
    return dir
  }

  it('resolves the single stored version', () => {
    const store = fakeStore(['@opentelemetry+api-logs@0.220.0'])
    try {
      const found = soleStoreSource([store], '@opentelemetry/api-logs')
      assert.equal(found, join(store, '@opentelemetry+api-logs@0.220.0', 'node_modules', '@opentelemetry', 'api-logs'))
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })

  it('stays unresolved on multi-version ambiguity', () => {
    const store = fakeStore(['@opentelemetry+api-logs@0.220.0', '@opentelemetry+api-logs@0.221.0'])
    try {
      assert.equal(soleStoreSource([store], '@opentelemetry/api-logs'), undefined)
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })

  it('stays unresolved when absent', () => {
    const store = fakeStore([])
    try {
      assert.equal(soleStoreSource([store], '@opentelemetry/api-logs'), undefined)
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })
})

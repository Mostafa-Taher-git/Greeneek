import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { externalDeps, pathContainsSegment, rangedStoreSource, satisfiesWanted, soleStoreSource } from '../scripts/stage.mjs'

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

describe('satisfiesWanted', () => {
  it('matches exact pins, carets, and tildes', () => {
    assert.equal(satisfiesWanted('2.9.0', '2.9.0'), true)
    assert.equal(satisfiesWanted('2.10.0', '2.9.0'), false)
    assert.equal(satisfiesWanted('2.10.0', '^2.9.0'), true)
    assert.equal(satisfiesWanted('3.0.0', '^2.9.0'), false)
    assert.equal(satisfiesWanted('0.220.5', '^0.220.0'), true)
    assert.equal(satisfiesWanted('0.221.0', '^0.220.0'), false)
    assert.equal(satisfiesWanted('2.9.4', '~2.9.0'), true)
    assert.equal(satisfiesWanted('2.10.0', '~2.9.0'), false)
  })

  it('rejects complex ranges and malformed versions', () => {
    assert.equal(satisfiesWanted('2.9.0', '>=2.0.0 <3.0.0'), false)
    assert.equal(satisfiesWanted('2.9', '2.9.0'), false)
    assert.equal(satisfiesWanted('2.9.0', '*'), false)
  })
})

describe('rangedStoreSource', () => {
  function fakeStore(names) {
    const dir = mkdtempSync(join(tmpdir(), 'greeneek-store-'))
    for (const name of names) {
      const pkgDir = join(dir, name, 'node_modules', '@opentelemetry', 'core')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@opentelemetry/core' }))
    }
    return dir
  }

  it('picks the exact pin from several stored versions', () => {
    const store = fakeStore(['@opentelemetry+core@2.9.0_@opentelemetry+api@1.9.1', '@opentelemetry+core@2.10.0_@opentelemetry+api@1.9.1'])
    try {
      const found = rangedStoreSource([store], '@opentelemetry/core', '2.9.0')
      assert.equal(found, join(store, '@opentelemetry+core@2.9.0_@opentelemetry+api@1.9.1', 'node_modules', '@opentelemetry', 'core'))
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })

  it('stays unresolved when the range matches several versions', () => {
    const store = fakeStore(['@opentelemetry+core@2.9.0_@opentelemetry+api@1.9.1', '@opentelemetry+core@2.10.0_@opentelemetry+api@1.9.1'])
    try {
      assert.equal(rangedStoreSource([store], '@opentelemetry/core', '^2.0.0'), undefined)
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })
})

describe('externalDeps', () => {
  it('marks peer-only deps separately from hard deps', () => {
    const { required, peerOnly } = externalDeps({
      dependencies: { 'left-pad': '1.3.0' },
      peerDependencies: { '@types/react-dom': '^18.0.0 || ^19.0.0', 'left-pad': '^1.0.0' },
    })
    assert.equal(required.has('@types/react-dom'), true)
    assert.equal(peerOnly.has('@types/react-dom'), true)
    assert.equal(peerOnly.has('left-pad'), false)
  })
})

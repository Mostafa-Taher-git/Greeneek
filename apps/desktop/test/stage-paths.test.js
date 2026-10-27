import { strict as assert } from 'node:assert'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  assertRequiredExternalDeps,
  assertSelfContainedStaging,
  copyDirRecursive,
  dereferenceEscapingSymlinks,
  externalDeps,
  isPathInside,
  isWorkspaceTree,
  pathContainsSegment,
  rangedStoreSource,
  resolvesInStaging,
  satisfiesWanted,
  soleStoreSource,
} from '../scripts/stage.mjs'

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

describe('isPathInside', () => {
  it('accepts the root and descendants on posix paths', () => {
    assert.equal(isPathInside('/repo/staging', '/repo/staging'), true)
    assert.equal(isPathInside('/repo/staging', '/repo/staging/node_modules/a'), true)
  })

  it('rejects siblings and paths that climb out', () => {
    assert.equal(isPathInside('/repo/staging', '/repo/other'), false)
    assert.equal(isPathInside('/repo/staging', '/repo/staging-backup'), false)
    assert.equal(isPathInside('/repo/staging', '/repo'), false)
  })

  it('handles windows paths', () => {
    assert.equal(isPathInside('C:\\repo\\staging', 'C:\\repo\\staging\\node_modules\\a'), true)
    assert.equal(isPathInside('C:\\repo\\staging', 'C:\\repo\\other'), false)
  })
})

describe('copyDirRecursive', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-copy-'))
    const source = join(root, 'source')
    mkdirSync(join(source, 'src'), { recursive: true })
    mkdirSync(join(source, 'node_modules', 'left-pad'), { recursive: true })
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: '@scope/source', version: '1.0.0' }))
    writeFileSync(join(source, 'src', 'index.js'), 'export const value = 1\n')
    writeFileSync(join(source, 'node_modules', 'left-pad', 'index.js'), 'export const pad = 1\n')
    return { root, source }
  }

  it('omits a dependency tree the caller hoists separately', () => {
    const { root, source } = fixture()
    const dest = join(root, 'dest')
    try {
      copyDirRecursive(source, dest, new Set(), true)
      assert.equal(existsSync(join(dest, 'src', 'index.js')), true)
      assert.equal(existsSync(join(dest, 'node_modules')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('copies dependency trees when the caller does not hoist them', () => {
    const { root, source } = fixture()
    const dest = join(root, 'dest')
    try {
      copyDirRecursive(source, dest)
      assert.equal(existsSync(join(dest, 'node_modules', 'left-pad', 'index.js')), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('terminates on a workspace link cycle', () => {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-copy-'))
    const a = join(root, 'packages', 'a')
    const b = join(root, 'packages', 'b')
    const dest = join(root, 'dest')
    mkdirSync(join(a, 'node_modules', '@scope'), { recursive: true })
    mkdirSync(join(b, 'node_modules', '@scope'), { recursive: true })
    writeFileSync(join(a, 'package.json'), JSON.stringify({ name: '@scope/a', version: '1.0.0' }))
    writeFileSync(join(b, 'package.json'), JSON.stringify({ name: '@scope/b', version: '1.0.0' }))
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    symlinkSync(b, join(a, 'node_modules', '@scope', 'b'), linkType)
    symlinkSync(a, join(b, 'node_modules', '@scope', 'a'), linkType)
    try {
      copyDirRecursive(a, dest, new Set(), true)
      assert.equal(existsSync(join(dest, 'package.json')), true)
      assert.equal(existsSync(join(dest, 'node_modules')), false)

      const followed = join(root, 'followed')
      copyDirRecursive(a, followed)
      assert.equal(existsSync(join(followed, 'node_modules', '@scope', 'b', 'package.json')), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('staging symlink closure', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-closure-'))
    const staging = join(root, 'staging')
    const outside = join(root, 'outside')
    mkdirSync(join(staging, 'node_modules', '@scope'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'package.json'), JSON.stringify({ name: '@scope/outside', version: '1.0.0' }))
    writeFileSync(join(outside, 'index.js'), 'export const value = 1\n')
    const link = join(staging, 'node_modules', '@scope', 'outside')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    return { root, staging, outside, link }
  }

  it('materializes an escaping package link as real files', () => {
    const { root, staging, link } = fixture()
    try {
      assert.equal(dereferenceEscapingSymlinks(staging), 1)
      assert.equal(lstatSync(link).isSymbolicLink(), false)
      assert.equal(existsSync(join(link, 'package.json')), true)
      assert.equal(existsSync(join(link, 'index.js')), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('materializes an escaping package link without its dependency tree', () => {
    const { root, staging, outside, link } = fixture()
    try {
      mkdirSync(join(outside, 'node_modules', 'left-pad'), { recursive: true })
      writeFileSync(join(outside, 'node_modules', 'left-pad', 'index.js'), 'export const pad = 1\n')
      dereferenceEscapingSymlinks(staging)
      assert.equal(existsSync(join(link, 'package.json')), true)
      assert.equal(existsSync(join(link, 'node_modules')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes a dangling link instead of failing the build', () => {
    const { root, staging, outside, link } = fixture()
    try {
      rmSync(outside, { recursive: true, force: true })
      assert.equal(dereferenceEscapingSymlinks(staging), 1)
      assert.equal(existsSync(link), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails the staging assertion while an escaping link remains', () => {
    const { root, staging } = fixture()
    try {
      assert.throws(() => assertSelfContainedStaging(staging), /escapes staging/)
      dereferenceEscapingSymlinks(staging)
      assert.doesNotThrow(() => assertSelfContainedStaging(staging))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('required external dependencies', () => {
  it('fails when a required external edge is missing from staging', () => {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-externals-'))
    const importer = join(root, 'node_modules', 'importer')
    mkdirSync(importer, { recursive: true })
    writeFileSync(join(importer, 'package.json'), JSON.stringify({
      name: 'importer',
      version: '1.0.0',
      dependencies: { 'left-pad': '1.3.0' },
    }))
    try {
      assert.throws(() => assertRequiredExternalDeps(root), /importer requires left-pad/)

      const dependency = join(root, 'node_modules', 'left-pad')
      mkdirSync(dependency, { recursive: true })
      writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'left-pad', version: '1.3.0' }))
      assert.doesNotThrow(() => assertRequiredExternalDeps(root))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores optional and peer-only edges', () => {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-externals-'))
    const importer = join(root, 'node_modules', 'importer')
    mkdirSync(importer, { recursive: true })
    writeFileSync(join(importer, 'package.json'), JSON.stringify({
      name: 'importer',
      version: '1.0.0',
      optionalDependencies: { 'left-pad': '1.3.0' },
      peerDependencies: { react: '^19.0.0' },
    }))
    try {
      assert.doesNotThrow(() => assertRequiredExternalDeps(root))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('isWorkspaceTree', () => {
  it('classifies first-party source trees on posix paths', () => {
    assert.equal(isWorkspaceTree('/home/runner/work/Greeneek/Greeneek/packages/core/gnk-tools'), true)
    assert.equal(isWorkspaceTree('/home/runner/work/Greeneek/Greeneek/apps/cli'), true)
    assert.equal(isWorkspaceTree('/home/runner/work/Greeneek/Greeneek/apps/desktop'), true)
    assert.equal(isWorkspaceTree('/home/runner/work/Greeneek/Greeneek/vendor/cordis'), true)
  })

  it('classifies first-party source trees on windows realpath output', () => {
    assert.equal(isWorkspaceTree('D:\\a\\Greeneek\\Greeneek\\packages\\core\\gnk-tools'), true)
    assert.equal(isWorkspaceTree('D:\\a\\Greeneek\\Greeneek\\apps\\cli'), true)
    assert.equal(isWorkspaceTree('D:\\a\\Greeneek\\Greeneek\\vendor\\cordis'), true)
  })

  it('rejects store, install, and lookalike paths', () => {
    // pnpm store and installed app trees are not sources: their copies must
    // stay real directories, never collapse into the top level.
    assert.equal(isWorkspaceTree('/home/runner/.pnpm-store/node_modules/.pnpm/gnk-tools@1.1.0/node_modules/@greeneek/gnk-tools'), false)
    assert.equal(isWorkspaceTree('/opt/Greeneek/resources/app/node_modules/@greeneek/gnk-tools'), false)
    assert.equal(isWorkspaceTree('/repo/packages-backup/gnk-tools'), false)
    assert.equal(isWorkspaceTree('/repo/myapps/cli'), false)
  })
})

describe('resolvesInStaging', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-resolve-'))
    const staging = join(root, 'staging')
    mkdirSync(join(staging, 'node_modules', '@scope', 'a'), { recursive: true })
    mkdirSync(join(staging, 'node_modules', '@scope', 'b'), { recursive: true })
    writeFileSync(join(staging, 'node_modules', '@scope', 'a', 'package.json'), JSON.stringify({ name: '@scope/a' }))
    writeFileSync(join(staging, 'node_modules', '@scope', 'b', 'package.json'), JSON.stringify({ name: '@scope/b' }))
    return { root, staging }
  }

  it('finds a sibling in the same hoisted node_modules', () => {
    const { root, staging } = fixture()
    try {
      assert.equal(resolvesInStaging(staging, join(staging, 'node_modules', '@scope', 'a'), '@scope/b'), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds a sibling of a nested package through its own node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-resolve-'))
    const staging = join(root, 'staging')
    const nested = join(staging, 'node_modules', 'outer', 'node_modules')
    mkdirSync(join(nested, '@scope', 'a'), { recursive: true })
    mkdirSync(join(nested, '@scope', 'b'), { recursive: true })
    writeFileSync(join(nested, '@scope', 'a', 'package.json'), JSON.stringify({ name: '@scope/a' }))
    writeFileSync(join(nested, '@scope', 'b', 'package.json'), JSON.stringify({ name: '@scope/b' }))
    try {
      assert.equal(resolvesInStaging(staging, join(nested, '@scope', 'a'), '@scope/b'), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a link that resolves outside staging', () => {
    const root = mkdtempSync(join(tmpdir(), 'greeneek-resolve-'))
    const staging = join(root, 'staging')
    const outside = join(root, 'outside')
    mkdirSync(join(staging, 'node_modules', 'importer'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(staging, 'node_modules', 'importer', 'package.json'), JSON.stringify({ name: 'importer' }))
    writeFileSync(join(outside, 'package.json'), JSON.stringify({ name: 'escaped' }))
    symlinkSync(outside, join(staging, 'node_modules', 'escaped'), process.platform === 'win32' ? 'junction' : 'dir')
    try {
      assert.equal(resolvesInStaging(staging, join(staging, 'node_modules', 'importer'), 'escaped'), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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

  it('finds a long-name entry that pnpm shortened and hashed', () => {
    const store = mkdtempSync(join(tmpdir(), 'greeneek-store-'))
    const entry = '@opentelemetry+otlp-transfo_adebf0a8d1ff4f09f266f1af6344adea'
    const pkgDir = join(store, entry, 'node_modules', '@opentelemetry', 'otlp-transformer')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@opentelemetry/otlp-transformer',
      version: '0.220.0',
    }))
    try {
      assert.equal(soleStoreSource([store], '@opentelemetry/otlp-transformer'), pkgDir)
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

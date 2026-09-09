import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertClientBuildEnvironment,
  clientBuildEnvironmentDefines,
  clientBuildProcessEnvironment,
  officialClientBuildEnvironment,
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  repositoryCommitHash,
  repositoryGitDirty,
  repositoryVersion,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { clientBundle } from '../packages/client/tsdown.client.ts'

const root = resolve(import.meta.dirname, '..')
const PROBE_NAME = 'GNK_CLIENT_BUILD_TEST'
const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'
const PROBE_KEY = `process.env.${PROBE_NAME}`
const originalProbe = process.env[PROBE_NAME]
const roots: string[] = []
const gnkBuildWorkflows = [
  'ci.yml',
  'desktop-windows.yml',
  'desktop.yml',
]

afterEach(() => {
  if (originalProbe === undefined) Reflect.deleteProperty(process.env, PROBE_NAME)
  else process.env[PROBE_NAME] = originalProbe
  vi.resetModules()
  for (const fixtureRoot of roots.splice(0)) rmSync(fixtureRoot, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'gnk-client-build-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'apps/web/dist/index.html'), '<main></main>')
  write(join(fixtureRoot, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(fixtureRoot, environment)
  return fixtureRoot
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function repositoryFixture(version = '1.2.3-rc.4'): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'gnk-client-build-repository-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
  git(fixtureRoot, ['init'])
  git(fixtureRoot, ['config', 'user.name', 'GNK test'])
  git(fixtureRoot, ['config', 'user.email', 'gnk-test@example.invalid'])
  git(fixtureRoot, ['add', 'package.json', 'tracked.txt'])
  git(fixtureRoot, ['commit', '-m', 'fixture'])
  return fixtureRoot
}

describe('client build environment', () => {
  it('requires an exact public environment for a named artifact profile', () => {
    const expected = {
      GNK_CLIENT_BUILD_PROFILE: 'official',
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_TITLE: 'Greeneek',
      GNK_CLIENT_VERSION: '1.2.3',
    } as const

    expect(() => { assertClientBuildEnvironment({ PATH: '/bin', ...expected }, expected) }).not.toThrow()
    expect(() => { assertClientBuildEnvironment({}, expected) }).toThrow(/GNK_CLIENT_TITLE/)
    expect(() => { assertClientBuildEnvironment({ GNK_CLIENT_TITLE: 'Other' }, expected) }).toThrow(/GNK_CLIENT_TITLE/)
    expect(() => {
      assertClientBuildEnvironment({ ...expected, GNK_CLIENT_UNDECLARED: 'value' }, expected)
    }).toThrow(/GNK_CLIENT_UNDECLARED/)
  })

  it('inherits public values by default and isolates an explicit official profile', () => {
    const parent = {
      PATH: '/bin',
      GNK_BUILD_CLIENT_PROFILE: 'official',
      GNK_CLIENT_BUILD_PROFILE: 'local',
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_GIT_DIRTY: 'true',
      GNK_CLIENT_TITLE: 'Local title',
      GNK_CLIENT_VERSION: '1.2.3',
      GNK_CLIENT_EXTRA: 'local-extra',
    }

    expect(resolveClientBuildEnvironment({ GNK_CLIENT_TITLE: 'Local title' })).toEqual({
      GNK_CLIENT_TITLE: 'Local title',
    })
    expect(resolveClientBuildEnvironment(parent)).toEqual({
      GNK_CLIENT_BUILD_PROFILE: 'official',
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_TITLE: 'Greeneek',
      GNK_CLIENT_VERSION: '1.2.3',
    })
    expect(() => {
      resolveClientBuildEnvironment({ GNK_BUILD_CLIENT_PROFILE: 'official' })
    }).toThrow(/GNK_CLIENT_COMMIT_HASH/)
    expect(() => {
      resolveClientBuildEnvironment({
        GNK_BUILD_CLIENT_PROFILE: 'official',
        GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      })
    }).toThrow(/GNK_CLIENT_VERSION/)
    expect(() => { resolveClientBuildEnvironment({}, 'unknown') }).toThrow(/unknown client build profile/)
    expect(clientBuildProcessEnvironment(parent, {
      GNK_CLIENT_BUILD_PROFILE: 'official',
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_TITLE: 'Greeneek',
      GNK_CLIENT_VERSION: '1.2.3',
    })).toEqual({
      PATH: '/bin',
      GNK_CLIENT_BUILD_PROFILE: 'official',
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_TITLE: 'Greeneek',
      GNK_CLIENT_VERSION: '1.2.3',
    })
    expect(repositoryCommitHash('/unused', { GNK_CLIENT_COMMIT_HASH: COMMIT_HASH })).toBe(COMMIT_HASH.slice(0, 7))
  })

  it('owns repository version, commit, and dirty metadata for complete builds', () => {
    const fixtureRoot = repositoryFixture()
    const commit = git(fixtureRoot, ['rev-parse', '--short=7', 'HEAD'])

    expect(repositoryVersion(fixtureRoot)).toBe('1.2.3-rc.4')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH,
      GNK_CLIENT_EXTRA: 'preserved',
      GNK_CLIENT_GIT_DIRTY: 'true',
      GNK_CLIENT_VERSION: 'spoofed',
    })).toEqual({
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_EXTRA: 'preserved',
      GNK_CLIENT_VERSION: '1.2.3-rc.4',
    })
    expect(officialClientBuildEnvironment(fixtureRoot)).toEqual({
      GNK_CLIENT_BUILD_PROFILE: 'official',
      GNK_CLIENT_COMMIT_HASH: commit,
      GNK_CLIENT_TITLE: 'Greeneek',
      GNK_CLIENT_VERSION: '1.2.3-rc.4',
    })

    write(join(fixtureRoot, '.gitignore'), 'ignored.txt\n')
    git(fixtureRoot, ['add', '.gitignore'])
    git(fixtureRoot, ['commit', '-m', 'ignore fixture'])
    write(join(fixtureRoot, 'ignored.txt'), 'ignored\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    rmSync(join(fixtureRoot, 'ignored.txt'))

    write(join(fixtureRoot, 'tracked.txt'), 'unstaged\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'tracked.txt'), 'staged\n')
    git(fixtureRoot, ['add', 'tracked.txt'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    git(fixtureRoot, ['commit', '-m', 'staged fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'untracked.txt'), 'untracked\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH,
    })).toEqual({
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_GIT_DIRTY: 'true',
      GNK_CLIENT_VERSION: '1.2.3-rc.4',
    })

    rmSync(join(fixtureRoot, 'untracked.txt'))
    const submoduleSource = repositoryFixture('9.8.7')
    git(fixtureRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSource, 'submodule'])
    git(fixtureRoot, ['commit', '-am', 'submodule fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    write(join(fixtureRoot, 'submodule/tracked.txt'), 'modified submodule\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
  })

  it('omits dirty metadata when repository metadata is unavailable', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'gnk-client-build-no-git-'))
    roots.push(fixtureRoot)
    write(join(fixtureRoot, 'package.json'), '{"version":"2.0.0"}\n')

    expect(repositoryGitDirty(fixtureRoot)).toBeUndefined()
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH,
      GNK_CLIENT_GIT_DIRTY: 'true',
    })).toEqual({
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_VERSION: '2.0.0',
    })
  })

  it('defines only public client values over a non-enumerable fallback', () => {
    expect(clientBuildEnvironmentDefines({
      PATH: '/bin',
      GNK_TEST_API_KEY: 'secret',
      GNK_CLIENT_VARIANT: 'quoted "value"',
      GNK_CLIENT_EMPTY: '',
      GNK_CLIENT_UNSET: undefined,
    })).toEqual({
      'process.env': '{}',
      'process.env.GNK_CLIENT_EMPTY': '""',
      'process.env.GNK_CLIENT_VARIANT': '"quoted \\"value\\""',
    })
  })

  it('feeds the same build-process value to dynamic tsdown bundles and the Vite shell', async () => {
    process.env[PROBE_NAME] = 'shared-value'

    const configs = clientBundle('@greeneek/gnk-client-ui-sidebar', [
      'lib/types/index.js',
      'lib/types/invariant.js',
    ])({ env: { GNK_BUILD_FACE: 'client' } })
    if (!Array.isArray(configs)) throw new TypeError('client bundle config must be an array')
    const dynamic = configs.find(config => config.name === '@greeneek/gnk-client-ui-sidebar/client')
    expect(dynamic?.define).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })

    const viteConfigPath = '../apps/web/vite.config.ts'
    const viteModule: unknown = await import(viteConfigPath)
    if (typeof viteModule !== 'object' || viteModule === null) {
      throw new TypeError('web Vite config module must be an object')
    }
    const viteConfig: unknown = Reflect.get(viteModule, 'default')
    if (typeof viteConfig === 'function') throw new TypeError('web Vite config must be an object')
    if (typeof viteConfig !== 'object' || viteConfig === null) {
      throw new TypeError('web Vite config must be an object')
    }
    expect(Reflect.get(viteConfig, 'define')).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })
  })

  it('binds the recorded environment to a complete set of client artifacts', () => {
    const officialEnvironment = {
      GNK_CLIENT_BUILD_PROFILE: 'official',
      GNK_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      GNK_CLIENT_TITLE: 'Greeneek',
      GNK_CLIENT_VERSION: '1.2.3',
    }
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})

    expect(readClientBuildRecord(official, officialEnvironment).environment).toEqual(officialEnvironment)
    expect(() => { readClientBuildRecord(defaultBuild, officialEnvironment) }).toThrow(/GNK_CLIENT_/)
    expect(() => { readClientBuildRecord(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)

    write(join(official, 'apps/web/dist/index.html'), '<main>changed</main>')
    expect(() => { readClientBuildRecord(official) }).toThrow(/artifacts differ/)
  })

  it('keeps public client values out of workflow-wide environments', () => {
    for (const name of gnkBuildWorkflows) {
      const path = `.github/workflows/${name}`
      const document: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new TypeError(`${path} must contain a workflow object`)
      }
      expect(JSON.stringify(document), path).not.toContain('GNK_CLIENT_')
    }
  })
})

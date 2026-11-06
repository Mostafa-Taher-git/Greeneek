import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { isLocalScratch, ROOT_DOTFILE_ALLOWLIST, stagedPaths } from './verify-no-local-scratch.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One throwaway repository whose index a test controls. */
function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-no-scratch-'))
  roots.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'gate@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Gate'], { cwd: root })
  return root
}

describe('root dotfile scratch rule', () => {
  it('admits every allowlisted project dotfile', () => {
    for (const name of ROOT_DOTFILE_ALLOWLIST) expect(isLocalScratch(name)).toBe(false)
  })

  it('refuses root dotfiles that hold investigation output', () => {
    for (const path of [
      '.br-classify.mjs',
      '.cov-scope2.txt',
      '.plan-classify.mjs',
      '.commit-msg.txt',
      '.env',
      '.env.local',
      '.j1.json',
    ]) {
      expect(isLocalScratch(path), path).toBe(true)
    }
  })

  it('refuses the two scratch locations outside the root', () => {
    expect(isLocalScratch('.recore/recore-web-goldens/recore.patch')).toBe(true)
    expect(isLocalScratch('scripts/scratch-profile-guard.mts')).toBe(true)
    expect(isLocalScratch('scripts\\scratch-profile-guard.mts')).toBe(true)
  })

  it('admits ordinary sources and nested configuration files', () => {
    for (const path of [
      'README.md',
      'scripts/run-gates.ts',
      'scripts/verify-no-local-scratch.ts',
      '.agents/notes/README.md',
      'packages/client/ui-theme/.gitignore',
      'docs/.hidden.md',
    ]) {
      expect(isLocalScratch(path), path).toBe(false)
    }
  })
})

describe('staged path reading', () => {
  it('reports only staged added, modified, and renamed paths', () => {
    const root = scratchRepo()
    writeFileSync(join(root, 'kept.txt'), 'kept\n')
    writeFileSync(join(root, '.cov-dump.txt'), 'scratch\n')
    mkdirSync(join(root, '.recore'), { recursive: true })
    writeFileSync(join(root, '.recore', 'status.txt'), 'scratch\n')
    writeFileSync(join(root, 'untracked.txt'), 'not staged\n')
    execFileSync('git', ['add', '--', 'kept.txt', '.cov-dump.txt', '.recore/status.txt'], { cwd: root })

    const paths = stagedPaths(root).filter(isLocalScratch)
    expect(paths.sort()).toEqual(['.cov-dump.txt', '.recore/status.txt'])
  })

  it('reports nothing for an empty index', () => {
    expect(stagedPaths(scratchRepo())).toEqual([])
  })
})

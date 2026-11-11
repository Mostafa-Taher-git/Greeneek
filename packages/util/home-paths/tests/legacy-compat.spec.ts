import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_HOME_DIR_NAMES, LEGACY_HOME_ENV, legacyHomeConfig, migrateGnkHome, resolveGnkHome } from '@greeneek/gnk-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('legacy home compatibility (rebrand shim, ends v1.0)', () => {
  it('names the legacy env var and directory exactly once', () => {
    expect(LEGACY_HOME_ENV).toBe('DSH_HOME') // rebrand:keep
    expect([...LEGACY_HOME_DIR_NAMES]).toEqual(['.dsh']) // rebrand:keep
  })

  it('lets the legacy env var select the home when the canonical one is unset', () => {
    expect(resolveGnkHome(undefined, { DSH_HOME: '/legacy-home' })).toBe(resolve('/legacy-home')) // rebrand:keep
  })

  it('never lets the legacy env var shadow a canonical value', () => {
    expect(resolveGnkHome(undefined, { GNK_HOME: '/gnk-home', DSH_HOME: '/legacy-home' })).toBe(resolve('/gnk-home')) // rebrand:keep
    expect(resolveGnkHome('/configured', { GNK_HOME: '/gnk-home', DSH_HOME: '/legacy-home' })).toBe(resolve('/configured')) // rebrand:keep
  })

  it('reads the legacy config key without touching the current one', () => {
    expect(legacyHomeConfig({ dshHome: '~/old-home' })).toBe('~/old-home') // rebrand:keep
    expect(legacyHomeConfig({ gnkHome: '~/new-home' })).toBeUndefined()
    expect(legacyHomeConfig({ dshHome: '' })).toBeUndefined() // rebrand:keep
    expect(legacyHomeConfig({ dshHome: 42 })).toBeUndefined() // rebrand:keep
  })

  it('copies the legacy home to the new one and leaves a notice behind', async () => {
    const home = await mkdtemp(join(tmpdir(), 'gnk-migrate-'))
    try {
      const legacy = join(home, '.dsh', 'settings') // rebrand:keep
      await mkdir(legacy, { recursive: true })
      await writeFile(join(legacy, 'cordis.yml'), 'home: keep-me\n', 'utf8')
      const result = await migrateGnkHome(home, {})
      expect(result).toMatchObject({ migrated: true, from: join(home, '.dsh'), to: join(home, '.gnk') }) // rebrand:keep
      expect(await readFile(join(home, '.gnk', 'settings', 'cordis.yml'), 'utf8')).toBe('home: keep-me\n')
      // Copy, never move: the rollback target must stay intact.
      expect(await readFile(join(home, '.dsh', 'settings', 'cordis.yml'), 'utf8')).toBe('home: keep-me\n') // rebrand:keep
      const notice = await readFile(join(home, '.dsh', 'MIGRATED-TO-GREENEEK.txt'), 'utf8') // rebrand:keep
      expect(notice).toContain('.gnk')
      // Idempotent: an existing target short-circuits any re-apply.
      await expect(migrateGnkHome(home, {})).resolves.toEqual({ migrated: false })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('stays out of the way when the user pinned a home of their own', async () => {
    const home = await mkdtemp(join(tmpdir(), 'gnk-pinned-'))
    try {
      await mkdir(join(home, '.dsh'), { recursive: true }) // rebrand:keep
      await expect(migrateGnkHome(home, { GNK_HOME: '/pinned/elsewhere' })).resolves.toEqual({ migrated: false })
      await expect(migrateGnkHome(home, { DSH_HOME: '/pinned/legacy' })).resolves.toEqual({ migrated: false }) // rebrand:keep
      await expect(readFile(join(home, '.gnk'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

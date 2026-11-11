/** Installed-bundle smoke helpers: install paths, bin discovery, smoke registry. */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { binEntries, installedPackagePath, PACKAGE_BIN_SMOKE_PACKAGES, resolveBinSmoke } from './publish-npm-baseline.ts'

describe('installed bundle smoke helpers', () => {
  it('places scoped packages under node_modules', () => {
    expect(installedPackagePath('/consumer', '@greeneek/gnk')).toBe(resolve('/consumer', 'node_modules/@greeneek/gnk'))
    expect(installedPackagePath('/consumer', '@greeneek/cordis')).toBe(resolve('/consumer', 'node_modules/@greeneek/cordis'))
  })

  it('reads the gnk object bin form', () => {
    expect(binEntries('@greeneek/gnk', { bin: { gnk: 'lib/bin.js' } })).toEqual([
      { name: 'gnk', entry: 'lib/bin.js' },
    ])
  })

  it('reads the cordis string bin form with the unscoped name', () => {
    expect(binEntries('@greeneek/cordis', { bin: 'bin.js' })).toEqual([
      { name: 'cordis', entry: 'bin.js' },
    ])
  })

  it('returns no bins for libraries and non-object manifests', () => {
    expect(binEntries('@greeneek/gnk-tools', {})).toEqual([])
    expect(binEntries('@greeneek/gnk-tools', null)).toEqual([])
    expect(binEntries('@greeneek/gnk-tools', 'nope')).toEqual([])
  })

  it('registers a smoke for every published bin package', () => {
    expect([...PACKAGE_BIN_SMOKE_PACKAGES].sort()).toEqual(['@greeneek/cordis', '@greeneek/gnk'])
    expect(resolveBinSmoke('@greeneek/gnk')).toBe('gnk')
    expect(resolveBinSmoke('@greeneek/cordis')).toBe('cordis')
  })

  it('fails loud on a bin package without a registered smoke', () => {
    expect(() => { resolveBinSmoke('@greeneek/new-tool') }).toThrow(/no package-owned smoke/)
  })
})

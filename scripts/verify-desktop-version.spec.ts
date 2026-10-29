/** Desktop version freshness policy. */
import { describe, expect, it } from 'vitest'
import {
  compareDesktopVersions, desktopVersionProblem, latestDesktopTag, parseDesktopVersion,
} from './verify-desktop-version.ts'

function parsed(version: string) {
  const result = parseDesktopVersion(version)
  if (result === undefined) throw new Error(`fixture ${version} is not parseable`)
  return result
}

describe('desktop release versions', () => {
  it('parses releases and prereleases', () => {
    expect(parsed('0.3.7')).toEqual({ major: 0, minor: 3, patch: 7, prerelease: [] })
    expect(parsed('0.3.7-rc.1')).toEqual({ major: 0, minor: 3, patch: 7, prerelease: ['rc', '1'] })
    expect(parseDesktopVersion('0.3')).toBeUndefined()
    expect(parseDesktopVersion('desktop-v0.3.7')).toBeUndefined()
  })

  it('orders prereleases below their release and numerics numerically', () => {
    expect(compareDesktopVersions(parsed('0.3.7'), parsed('0.3.7-rc.1'))).toBeGreaterThan(0)
    expect(compareDesktopVersions(parsed('0.3.7-rc.2'), parsed('0.3.7-rc.10'))).toBeLessThan(0)
    expect(compareDesktopVersions(parsed('0.3.8'), parsed('0.3.7'))).toBeGreaterThan(0)
    expect(compareDesktopVersions(parsed('0.3.7'), parsed('0.3.7'))).toBe(0)
  })

  it('finds the newest desktop tag and ignores other tags', () => {
    expect(latestDesktopTag(['desktop-v0.3.6', 'desktop-v0.3.10', 'v9.9.9', 'desktop-v0.3.7']))
      .toBe('desktop-v0.3.10')
    expect(latestDesktopTag([])).toBeUndefined()
  })

  it('rejects a checked-in version behind the release line', () => {
    expect(desktopVersionProblem('0.3.7', ['desktop-v0.3.6', 'desktop-v0.3.7'])).toBeUndefined()
    expect(desktopVersionProblem('0.3.8', ['desktop-v0.3.7'])).toBeUndefined()
    expect(desktopVersionProblem('0.2.0', ['desktop-v0.3.6']))
      .toContain('is behind the newest release desktop-v0.3.6')
  })

  it('fails loud when release tags or a valid version are absent', () => {
    expect(desktopVersionProblem('0.3.7', [])).toContain('no desktop-v* release tag')
    expect(desktopVersionProblem('dev', ['desktop-v0.3.6'])).toContain('not a release version')
  })
})

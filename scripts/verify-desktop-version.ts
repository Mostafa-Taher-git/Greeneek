/**
 * Keep the checked-in desktop version from falling behind the newest
 * `desktop-v*` release tag. Release builds stamp the manifest from the tag, so
 * a stale source version only leaks into development About screens and local
 * installers — exactly the v0.2.0 lie the About page showed while the release
 * line was already v0.3.6.
 *
 * The comparison ignores prerelease ordering details beyond "a prerelease is
 * lower than its release"; the gate needs the release line, not a full semver
 * implementation.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** One parsed desktop release version. */
export interface DesktopVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

/** Parse `x.y.z` or `x.y.z-prerelease`. */
export function parseDesktopVersion(version: string): DesktopVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Compare two release identifiers: negative when `a < b`, zero when equal. */
export function compareDesktopVersions(a: DesktopVersion, b: DesktopVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
    const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    if (leftNumber === undefined || rightNumber === undefined) {
      if (left !== right) return left < right ? -1 : 1
    }
  }
  return 0
}

/** Newest desktop release tag, or undefined when none was fetched. */
export function latestDesktopTag(tags: readonly string[]): string | undefined {
  let newest: { tag: string; version: DesktopVersion } | undefined
  for (const tag of tags) {
    if (!tag.startsWith('desktop-v')) continue
    const version = parseDesktopVersion(tag.slice('desktop-v'.length))
    if (version === undefined) continue
    if (newest === undefined || compareDesktopVersions(version, newest.version) > 0) {
      newest = { tag, version }
    }
  }
  return newest?.tag
}

/**
 * Why the checked-in desktop version is behind the release line, or undefined
 * when it is current or ahead.
 * @param manifestVersion - version declared by `apps/desktop/package.json`.
 * @param tags - fetched desktop tag names.
 * @returns one actionable message, or undefined when the version is valid.
 */
export function desktopVersionProblem(manifestVersion: string, tags: readonly string[]): string | undefined {
  const latest = latestDesktopTag(tags)
  const current = parseDesktopVersion(manifestVersion)
  if (current === undefined) return `apps/desktop version ${JSON.stringify(manifestVersion)} is not a release version`
  if (latest === undefined) {
    return 'no desktop-v* release tag was found; fetch the release tags before running verify-desktop-version'
  }
  const released = parseDesktopVersion(latest.slice('desktop-v'.length))
  if (released === undefined) return `desktop tag ${latest} is not a parseable release version`
  if (compareDesktopVersions(current, released) >= 0) return undefined
  return `apps/desktop version ${manifestVersion} is behind the newest release ${latest}; bump apps/desktop/package.json before the next release`
}

const isMainModule = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(import.meta.dirname, 'verify-desktop-version.ts')
if (isMainModule) {
  const root = resolve(import.meta.dirname, '..')
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/desktop/package.json'), 'utf8')) as { version?: unknown }
  const version = typeof manifest.version === 'string' ? manifest.version : ''
  const tags = execFileSync('git', ['tag', '--list', 'desktop-v*'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map(tag => tag.trim())
    .filter(tag => tag !== '')
  const problem = desktopVersionProblem(version, tags)
  if (problem !== undefined) {
    console.error(`verify-desktop-version: ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`verify-desktop-version: ${version} is current with ${latestDesktopTag(tags) ?? 'no tag'}.`)
  }
}

/**
 * Pure platform rules for the local Craft adapter: launcher paths, CLI
 * executable names, version floors, and registry output parsing.
 *
 * The ArtCraft launcher and MSI layouts are documented by the vendor, not
 * observed by this pilot. They stay here as data so a Windows end-to-end run
 * can correct exactly one module.
 * @module @greeneek/gnk-craft-local/platform
 */

import { posix, win32 } from 'node:path'
import type { CraftAppManifest } from '@greeneek/gnk-craft'
import type { CraftInstallRecord } from './types.ts'

/** Launcher directory name on Windows and macOS. */
const LAUNCHER_NAME = 'ArtCraft Launcher'
/** Launcher directory name on Linux. */
const LAUNCHER_NAME_LINUX = 'artcraft-launcher'

/** One numeric semantic version triple. */
interface VersionTriple {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/** Vendor version grammar accepted at the discovery boundary (suffix ignored). */
const VERSION_PREFIX = /^(\d+)\.(\d+)\.(\d+)/

/**
 * Path flavor for one platform: Windows separators for `win32`, POSIX
 * separators everywhere else. Discovery may target a platform other than the
 * CI host, so it must never rely on the host's `node:path` flavor.
 * @param platform - target platform.
 * @returns the matching `node:path` module surface.
 */
export function platformPath(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

/**
 * The CLI executable file name for one platform.
 * @param stem - manifest CLI stem (`photocraft`).
 * @param platform - host platform.
 * @returns `<stem>-cli` plus `.exe` on Windows.
 */
export function cliExecutableName(stem: string, platform: NodeJS.Platform): string {
  return `${stem}-cli${platform === 'win32' ? '.exe' : ''}`
}

/**
 * The GUI executable file name for one platform.
 * @param stem - manifest CLI stem (`photocraft`).
 * @param platform - host platform.
 * @returns `<stem>` plus `.exe` on Windows.
 */
export function guiExecutableName(stem: string, platform: NodeJS.Platform): string {
  return `${stem}${platform === 'win32' ? '.exe' : ''}`
}

/**
 * Launcher state directories for one host, in lookup order.
 * @param platform - host platform.
 * @param env - environment used for overrides.
 * @param home - home directory.
 * @returns absolute launcher directories.
 */
export function launcherRoots(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): readonly string[] {
  const path = platformPath(platform)
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    return [path.join(localAppData !== undefined && localAppData !== '' ? localAppData : path.join(home, 'AppData', 'Local'), LAUNCHER_NAME)]
  }
  if (platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', LAUNCHER_NAME)]
  }
  const xdgData = env.XDG_DATA_HOME
  return [path.join(xdgData !== undefined && xdgData !== '' ? xdgData : path.join(home, '.local', 'share'), LAUNCHER_NAME_LINUX)]
}

/**
 * Parse the shared launcher manifest into one app record. Both the flat
 * per-app shape and the `{ apps: { <id>: … } }` shape are accepted because the
 * vendor format is unverified.
 * @param text - raw `installed.json` content.
 * @param app - manifest whose id and aliases key the lookup.
 * @returns the usable install record, or undefined when absent/malformed.
 */
export function parseInstalledJson(text: string, app: CraftAppManifest): CraftInstallRecord | undefined {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return undefined
  const record = decoded as Record<string, unknown>
  const apps = record.apps
  let candidate: unknown = record
  if (typeof apps === 'object' && apps !== null && !Array.isArray(apps)) {
    const byApp = apps as Record<string, unknown>
    candidate = byApp[app.id] ?? app.aliases.map(alias => byApp[alias]).find(entry => entry !== undefined)
  }
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
  const entry = candidate as Record<string, unknown>
  const installDir = nonEmptyString(entry.installDir)
  const version = nonEmptyString(entry.version)
  if (installDir === undefined && version === undefined) return undefined
  return {
    ...installDir === undefined ? {} : { installDir },
    ...version === undefined ? {} : { version },
  }
}

/**
 * Extract the `InstallDir` value from `reg.exe query` output.
 * @param text - raw registry output.
 * @returns the trimmed directory, or undefined when the value is absent.
 */
export function parseRegistryInstallDir(text: string): string | undefined {
  const match = /InstallDir\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/im.exec(text)
  if (match === null) return undefined
  return nonEmptyString(match[1])
}

/**
 * Compare two semantic versions by numeric triple.
 * @param left - candidate version.
 * @param right - reference version.
 * @returns negative/zero/positive, or undefined when either value is unparseable.
 */
export function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return undefined
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch)
}

/**
 * Whether an installed version meets the manifest floor. Unparseable
 * installed versions are treated as satisfying the floor because the vendor
 * suffix grammar is unverified; a known-old version is not.
 * @param installed - version reported by discovery.
 * @param floor - manifest `minVersion`.
 * @returns `true` when the version may be used.
 */
export function meetsVersionFloor(installed: string | undefined, floor: string): boolean {
  if (installed === undefined) return true
  const comparison = compareVersions(installed, floor)
  return comparison === undefined || comparison >= 0
}

/** Parse one version triple, ignoring vendor suffixes. */
function parseVersion(value: string): VersionTriple | undefined {
  const match = VERSION_PREFIX.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

/** Narrow one untrusted value to a trimmed non-empty string. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

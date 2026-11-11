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
 * Locate the ArtCraft launcher's Rust state file on Windows.
 * @param platform - host platform.
 * @param env - ambient environment.
 * @param home - home directory fallback.
 * @returns the absolute app.ron path, or undefined off Windows.
 */
export function launcherRonPath(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string | undefined {
  if (platform !== 'win32') return undefined
  const roaming = env.APPDATA !== undefined && env.APPDATA !== ''
    ? env.APPDATA
    : platformPath(platform).join(home, 'AppData', 'Roaming')
  return platformPath(platform).join(roaming, 'ai.storyteller.artcraft-launcher', 'data', 'app.ron')
}

/**
 * Read one app's per-app install directory from the launcher's Rust state.
 * The state is a debug-formatted map; only the `per_app` string map is parsed,
 * and a missing or malformed map is no record rather than a failure.
 * @param text - raw `app.ron` content.
 * @param app - manifest whose id and aliases key the lookup.
 * @returns the declared install directory, or undefined.
 */
export function parseLauncherAppRon(text: string, app: CraftAppManifest): CraftInstallRecord | undefined {
  const section = /per_app:\s*\{([^}]*)\}/u.exec(text.replaceAll('\\"', '"'))?.[1]
  if (section === undefined) return undefined
  for (const id of [app.id, ...app.aliases]) {
    const match = new RegExp(`"${id}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'u').exec(section)
    const raw = match?.[1]
    if (raw === undefined) continue
    const installDir = raw.replace(/\\\\/gu, '\\')
    if (installDir.trim() !== '') return { installDir }
  }
  return undefined
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
 * Normalize one launcher key into a Craft app id.
 * @param value - raw key such as `PhotoCraft` or `Office Craft`.
 * @returns the kebab-case id, or undefined when no usable id remains.
 */
export function normalizeArtCraftId(value: string): string | undefined {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return /^[a-z][a-z0-9-]{1,31}$/.test(id) ? id : undefined
}

/**
 * Parse every app entry in the shared launcher manifest.
 * @param text - raw `installed.json` content.
 * @returns one record per app id, or empty when absent/malformed.
 */
export function parseInstalledJsonAll(text: string): readonly CraftInstallEntry[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return []
  const record = decoded as Record<string, unknown>
  const apps = record.apps
  if (typeof apps === 'object' && apps !== null && !Array.isArray(apps)) {
    return Object.entries(apps as Record<string, unknown>).flatMap(([key, entry]) => {
      const id = normalizeArtCraftId(key)
      if (id === undefined || typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
      const fields = entry as Record<string, unknown>
      const parsed = installEntry(id, fields)
      return parsed === undefined ? [] : [parsed]
    })
  }
  if (typeof record.id === 'string') {
    const id = normalizeArtCraftId(record.id)
    if (id !== undefined) {
      const parsed = installEntry(id, record)
      if (parsed !== undefined) return [parsed]
    }
  }
  return []
}

/**
 * Parse every entry in the launcher's Rust `per_app` map.
 * @param text - raw `app.ron` content.
 * @returns one record per app id, or empty when absent/malformed.
 */
export function parseLauncherAppRonAll(text: string): readonly CraftInstallEntry[] {
  const normalized = text.replaceAll('\\"', '"')
  const section = /per_app:\s*\{([^}]*)\}/u.exec(normalized)?.[1]
  if (section === undefined) return []
  const entries: CraftInstallEntry[] = []
  const pattern = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gu
  let match = pattern.exec(section)
  while (match !== null) {
    const id = normalizeArtCraftId(match[1] as string)
    const installDir = (match[2] as string).replace(/\\\\/gu, '\\').trim()
    if (id !== undefined && installDir !== '') entries.push({ id, installDir })
    match = pattern.exec(section)
  }
  return entries
}

/** One generic install entry read from a launcher source. */
export interface CraftInstallEntry {
  /** Canonical app id. */
  readonly id: string
  /** Human-readable product name when declared. */
  readonly displayName?: string
  /** Absolute install directory when declared. */
  readonly installDir?: string
  /** Installed product version when declared. */
  readonly version?: string
  /** CLI executable stem when declared. */
  readonly cliStem?: string
}

/** Build one entry from untrusted record fields. */
function installEntry(id: string, fields: Record<string, unknown>): CraftInstallEntry | undefined {
  const installDir = nonEmptyString(fields.installDir) ?? nonEmptyString(fields.path)
  const version = nonEmptyString(fields.version)
  const displayName = nonEmptyString(fields.displayName) ?? normalizeDisplayName(id)
  const cliStem = nonEmptyString(fields.cliStem) ?? nonEmptyString(fields.cli)
  if (installDir === undefined && version === undefined) return undefined
  return {
    id,
    displayName,
    ...installDir === undefined ? {} : { installDir },
    ...version === undefined ? {} : { version },
    ...cliStem === undefined ? {} : { cliStem },
  }
}

/** Default display name from one app id (`pdfcraft` -> `PdfCraft`). */
function normalizeDisplayName(id: string): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

/**
 * Parse a desktop application directory entry for one ArtCraft app file.
 * @param text - raw desktop file content.
 * @param fileName - desktop file name such as `artcraft-photo.desktop`.
 * @returns the install entry, or undefined when not an ArtCraft app.
 */
export function parseDesktopFile(text: string, fileName: string): CraftInstallEntry | undefined {
  const base = fileName.toLowerCase()
  if (!base.startsWith('artcraft-') && !base.includes('artcraft')) return undefined
  const stem = base.replace(/\.desktop$/u, '').replace(/^artcraft-/, '').replace(/^artcraft/, '')
  const id = normalizeArtCraftId(stem)
  if (id === undefined) return undefined
  let displayName: string | undefined
  let installDir: string | undefined
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Name=') && displayName === undefined) {
      const value = trimmed.slice(5).trim()
      if (value !== '') displayName = value
    }
    if (trimmed.startsWith('Exec=') && installDir === undefined) {
      const exec = trimmed.slice(5).trim().split(/\s+/u)[0] as string
      if (exec !== '') installDir = exec.slice(0, exec.lastIndexOf('/') + 1).replace(/\/$/u, '') || undefined
    }
  }
  return {
    id,
    ...displayName === undefined ? {} : { displayName },
    ...installDir === undefined ? {} : { installDir },
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
 * Parse every `InstallDir` block from one recursive registry query.
 * @param text - raw `reg query HKLM\Software /f InstallDir /s` output.
 * @returns display name to install directory, keyed by registry subkey name.
 */
export function parseRegistryInstallDirs(text: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  let current: string | undefined
  for (const line of text.split(/\r?\n/u)) {
    const header = /^HKEY_LOCAL_MACHINE\\Software\\([^\\]+)$/u.exec(line.trim())
    if (header !== null) {
      current = header[1]
      continue
    }
    if (current === undefined) continue
    const value = /^\s*InstallDir\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/u.exec(line)
    if (value !== null) {
      const dir = nonEmptyString(value[1])
      if (dir !== undefined) result[current] = dir
    }
  }
  return result
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

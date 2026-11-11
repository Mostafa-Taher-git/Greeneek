/**
 * Discovery for one Craft app: launcher manifest, portable marker, then the
 * Windows MSI registry value. The first candidate with a present CLI wins, so
 * a stale launcher record cannot shadow a working install.
 * @module @greeneek/gnk-craft-local/discovery
 */

import type { CraftAppManifest, CraftDiscovery, CraftDiscoveredApp, CraftPlatform } from '@greeneek/gnk-craft'
import {
  cliExecutableName,
  launcherRonPath,
  launcherRoots,
  meetsVersionFloor,
  normalizeArtCraftId,
  parseDesktopFile,
  parseInstalledJson,
  parseInstalledJsonAll,
  parseLauncherAppRon,
  parseLauncherAppRonAll,
  platformPath,
} from './platform.ts'
import type { CraftInstallEntry } from './platform.ts'
import type { CraftDiscoveryIo, CraftInstallRecord } from './types.ts'

/** Shared launcher manifest file name. */
export const INSTALLED_FILE = 'installed.json'

/**
 * Portable install marker file name for one app id.
 * @param app - canonical or alias id.
 * @returns `<id>.portable.txt`.
 */
export function portableFileName(app: string): string {
  return `${app}.portable.txt`
}

/**
 * Measure one installation without spawning it.
 * @param app - validated manifest.
 * @param io - discovery seam.
 * @returns one of `not-installed`, `app-installed-cli-missing`,
 * `unsupported-version`, or `ready`.
 */
export function discoverApp(app: CraftAppManifest, io: CraftDiscoveryIo): CraftDiscovery {
  if (!app.platforms.includes(io.platform as CraftPlatform)) {
    return {
      state: 'not-installed',
      detail: `${app.displayName} documents ${app.platforms.join(' and ')} support; this host is ${io.platform}`,
    }
  }
  const candidates = readCandidates(app, io)
  if (candidates.length === 0) {
    return {
      state: 'not-installed',
      detail: `no ${app.displayName} installation was found in the ArtCraft launcher state or the Windows registry`,
    }
  }
  const path = platformPath(io.platform)
  let outdated: { readonly version: string; readonly executable: string } | undefined
  let expected: string | undefined
  for (const record of candidates) {
    const root = record.installDir as string
    const executableName = cliExecutableName(app.cliStem, io.platform)
    const candidatesInRoot = [
      path.join(root, executableName),
      path.join(root, app.displayName, executableName),
      path.join(root, app.id, executableName),
      path.join(root, app.cliStem, executableName),
    ]
    const executable = candidatesInRoot.find(candidate => io.isFile(candidate))
    if (executable === undefined) {
      expected ??= candidatesInRoot[0]
      continue
    }
    const version = record.version
    if (version !== undefined && !meetsVersionFloor(version, app.minVersion)) {
      outdated ??= { version, executable }
      continue
    }
    return {
      state: 'ready',
      executable,
      ...version === undefined ? {} : { version },
    }
  }
  if (outdated !== undefined) {
    return {
      state: 'unsupported-version',
      executable: outdated.executable,
      version: outdated.version,
      detail: `${app.displayName} ${outdated.version} is older than the required ${app.minVersion}`,
    }
  }
  return {
    state: 'app-installed-cli-missing',
    detail: `${app.displayName} is installed but its headless CLI is missing (expected ${expected as string})`,
  }
}

/**
 * Enumerate every installed ArtCraft app without a hand-written manifest.
 *
 * Sources merge in priority order: the launcher `installed.json` app map, the
 * launcher `app.ron` `per_app` map, `<id>.portable.txt` markers, the OS
 * registry (Windows MSI `InstallDir` values), and Linux `.desktop` entries.
 * The first source naming an id wins; later sources fill missing fields.
 * @param io - discovery seam.
 * @returns every discovered app, deduplicated by canonical id, in discovery order.
 */
export function listInstalledApps(io: CraftDiscoveryIo): readonly CraftDiscoveredApp[] {
  const path = platformPath(io.platform)
  const merged = new Map<string, CraftDiscoveredApp>()
  const add = (entry: CraftInstallEntry, source: CraftDiscoveredApp['source']): void => {
    const existing = merged.get(entry.id)
    if (existing === undefined) {
      merged.set(entry.id, {
        id: entry.id,
        displayName: entry.displayName ?? titleCase(entry.id),
        ...entry.installDir === undefined ? {} : { installDir: entry.installDir },
        ...entry.version === undefined ? {} : { version: entry.version },
        ...entry.cliStem === undefined ? {} : { cliStem: entry.cliStem },
        source,
      })
      return
    }
    const next: { installDir?: string; version?: string; cliStem?: string } = {}
    if (existing.installDir === undefined && entry.installDir !== undefined) next.installDir = entry.installDir
    if (existing.version === undefined && entry.version !== undefined) next.version = entry.version
    if (existing.cliStem === undefined && entry.cliStem !== undefined) next.cliStem = entry.cliStem
    merged.set(entry.id, { ...existing, ...next })
  }
  const ronPath = launcherRonPath(io.platform, io.env, io.home)
  if (ronPath !== undefined) {
    const ron = io.readText(ronPath)
    if (ron !== undefined) {
      for (const entry of parseLauncherAppRonAll(ron)) add(entry, 'launcher-state')
    }
  }
  for (const root of launcherRoots(io.platform, io.env, io.home)) {
    const installed = io.readText(path.join(root, INSTALLED_FILE))
    if (installed !== undefined) {
      for (const entry of parseInstalledJsonAll(installed)) add(entry, 'launcher-manifest')
    }
    for (const name of io.listDir?.(root) ?? []) {
      if (!name.endsWith('.portable.txt')) continue
      const id = normalizeArtCraftId(name.slice(0, -'.portable.txt'.length))
      if (id === undefined) continue
      const portable = io.readText(path.join(root, name))
      const installDir = portable?.trim()
      if (installDir !== undefined && installDir !== '') add({ id, installDir }, 'portable-marker')
    }
  }
  for (const entry of listOsRegistryApps(io)) add(entry, 'os-registry')
  for (const entry of listDesktopApps(io)) add(entry, 'desktop-entry')
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Enumerate Windows MSI installs, one entry per registry subkey with InstallDir. */
function listOsRegistryApps(io: CraftDiscoveryIo): readonly CraftInstallEntry[] {
  if (io.registryInstallDirs !== undefined) {
    return Object.entries(io.registryInstallDirs()).flatMap(([displayName, installDir]) => {
      const id = normalizeArtCraftId(displayName)
      if (id === undefined || installDir.trim() === '') return []
      return [{ id, displayName, installDir: installDir.trim() }]
    })
  }
  // Without a listing primitive the registry still resolves one app at a time
  // through `registryInstallDir`; enumeration stays manifest-driven.
  return []
}

/** Enumerate Linux `.desktop` entries under the XDG applications directories. */
function listDesktopApps(io: CraftDiscoveryIo): readonly CraftInstallEntry[] {
  if (io.platform !== 'linux') return []
  const path = platformPath(io.platform)
  const xdg = io.env.XDG_DATA_HOME
  const dataHome = xdg !== undefined && xdg !== '' ? xdg : path.join(io.home, '.local', 'share')
  const dirs = [
    path.join(dataHome, 'applications'),
    path.join('/usr', 'share', 'applications'),
  ]
  const entries: CraftInstallEntry[] = []
  for (const dir of dirs) {
    for (const name of io.listDir?.(dir) ?? []) {
      if (!name.endsWith('.desktop') || !name.toLowerCase().includes('artcraft')) continue
      const text = io.readText(path.join(dir, name))
      if (text === undefined) continue
      const entry = parseDesktopFile(text, name)
      if (entry !== undefined) entries.push(entry)
    }
  }
  return entries
}

/** Capitalize the first letter of one id for display when no name was reported. */
function titleCase(id: string): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

/**
 * Read every candidate install record with a directory, in priority order.
 * @param app - validated manifest.
 * @param io - discovery seam.
 * @returns deduplicated install records.
 */
function readCandidates(app: CraftAppManifest, io: CraftDiscoveryIo): readonly CraftInstallRecord[] {
  const path = platformPath(io.platform)
  const records: CraftInstallRecord[] = []
  const seen = new Set<string>()
  const add = (record: CraftInstallRecord): void => {
    if (record.installDir === undefined || seen.has(record.installDir)) return
    seen.add(record.installDir)
    records.push(record)
  }
  const ronPath = launcherRonPath(io.platform, io.env, io.home)
  if (ronPath !== undefined) {
    const ron = io.readText(ronPath)
    if (ron !== undefined) add(parseLauncherAppRon(ron, app) ?? {})
  }
  for (const root of launcherRoots(io.platform, io.env, io.home)) {
    const installed = io.readText(path.join(root, INSTALLED_FILE))
    if (installed !== undefined) add(parseInstalledJson(installed, app) ?? {})
    for (const id of [app.id, ...app.aliases]) {
      const portable = io.readText(path.join(root, portableFileName(id)))
      if (portable === undefined) continue
      const installDir = portable.trim()
      if (installDir !== '') add({ installDir })
    }
  }
  const registry = io.registryInstallDir(app)
  if (registry !== undefined) {
    const installDir = registry.trim()
    if (installDir !== '') add({ installDir })
  }
  return records
}

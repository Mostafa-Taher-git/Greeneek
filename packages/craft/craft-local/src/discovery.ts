/**
 * Discovery for one Craft app: launcher manifest, portable marker, then the
 * Windows MSI registry value. The first candidate with a present CLI wins, so
 * a stale launcher record cannot shadow a working install.
 * @module @greeneek/gnk-craft-local/discovery
 */

import type { CraftAppManifest, CraftDiscovery, CraftPlatform } from '@greeneek/gnk-craft'
import { cliExecutableName, launcherRoots, meetsVersionFloor, parseInstalledJson, platformPath } from './platform.ts'
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
 * @returns one of `not-installed`, `app-installed-cli-missing`, or `ready`.
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
    const executable = path.join(record.installDir as string, cliExecutableName(app.cliStem, io.platform))
    if (!io.isFile(executable)) {
      expected ??= executable
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
      state: 'app-installed-cli-missing',
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

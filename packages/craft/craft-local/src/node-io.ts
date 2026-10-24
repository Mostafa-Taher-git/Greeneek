/**
 * Node implementations of the local Craft boundaries.
 *
 * The discovery seams take injectable primitives so the platform-free logic in
 * `platform.ts`/`discovery.ts` gets exercised without touching a real
 * installation; this module owns only the default Node behavior.
 * @module @greeneek/gnk-craft-local/node-io
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { CraftAppManifest } from '@greeneek/gnk-craft'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import { parseRegistryInstallDir } from './platform.ts'
import type { CraftDiscoveryIo, CraftLocalIo } from './types.ts'

/** Registry query deadline: a missing hive fails fast instead of stalling startup. */
const REGISTRY_TIMEOUT_MS = 2_000

/** Synchronous external command runner, narrowed to what discovery needs. */
export type ExecText = (file: string, args: readonly string[]) => string

/** Optional defaults for tests and embeddings. */
export interface NodeIoOptions {
  /** Host platform override. */
  readonly platform?: NodeJS.Platform
  /** Environment override. */
  readonly env?: NodeJS.ProcessEnv
  /** Home directory override. */
  readonly home?: string
  /** Registry command override. */
  readonly exec?: ExecText
}

/**
 * Read one UTF-8 file, containing every filesystem failure.
 * @param path - absolute path.
 * @returns file text, or undefined when absent/unreadable.
 */
export function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Whether one path is a regular file, containing every filesystem failure.
 * @param path - absolute path.
 * @returns `true` for a readable regular file.
 */
export function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The Windows MSI install-directory query for one app.
 * @param app - manifest whose display name keys the registry value.
 * @param exec - command runner.
 * @returns the raw `reg.exe` output.
 */
export function queryRegistryInstallDir(app: CraftAppManifest, exec: ExecText): string {
  return exec('reg.exe', ['query', `HKLM\\Software\\${app.displayName}`, '/v', 'InstallDir'])
}

/**
 * Build the default Node discovery seam.
 * @param options - overrides used by tests.
 * @returns the discovery boundary.
 */
export function createNodeDiscoveryIo(options: NodeIoOptions = {}): CraftDiscoveryIo {
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? defaultExec
  return {
    platform,
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
    readText: readTextFile,
    isFile: isRegularFile,
    registryInstallDir(app) {
      if (platform !== 'win32') return undefined
      try {
        return parseRegistryInstallDir(queryRegistryInstallDir(app, exec))
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Build the default Node local-provider seam.
 * @param spawn - managed process spawner, normally `spec => ctx.subprocess.spawn(spec)`.
 * @param options - overrides used by tests.
 * @returns the local provider boundary.
 */
export function createNodeLocalIo(
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  options: NodeIoOptions & { readonly warn?: (message: string) => void } = {},
): CraftLocalIo {
  return {
    discovery: createNodeDiscoveryIo(options),
    ensureDir(path) {
      mkdirSync(path, { recursive: true })
    },
    writeFile(path, data) {
      writeFileSync(path, data, { encoding: 'utf8', mode: 0o600 })
    },
    spawn,
    ...options.warn === undefined ? {} : { warn: options.warn },
  }
}

/** Run one external command and return its stdout. */
export function defaultExec(file: string, args: readonly string[]): string {
  return execFileSync(file, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: REGISTRY_TIMEOUT_MS,
  })
}

/**
 * Host-provider vocabulary for the local Craft adapter.
 *
 * Everything platform-specific is injected so discovery, token-gated spawns,
 * and the JSON-RPC wire stay testable on any CI host without an ArtCraft
 * installation.
 * @module @greeneek/gnk-craft-local/types
 */

import type { SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import type { SubprocessHandle } from '@greeneek/gnk-subprocess'
import type { CraftAppManifest } from '@greeneek/gnk-craft'

/** One install fact read from a launcher manifest or the Windows registry. */
export interface CraftInstallRecord {
  /** Absolute install directory when the source declared one. */
  readonly installDir?: string
  /** Installed product version when the source declared one. */
  readonly version?: string
}

/**
 * Discovery boundary. Every filesystem, environment, home-directory, and
 * registry fact arrives through this seam so the four published states can be
 * exercised deterministically.
 */
export interface CraftDiscoveryIo {
  /** Host platform used for path layout and executable suffixes. */
  readonly platform: NodeJS.Platform
  /** Ambient environment subset used for launcher-root lookup. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Home directory used for launcher-root lookup. */
  readonly home: string
  /**
   * Read one UTF-8 file.
   * @param path - absolute file path.
   * @returns file text, or undefined when it does not exist or cannot be read.
   */
  readText(path: string): string | undefined
  /**
   * Whether one absolute path is a regular file.
   * @param path - absolute file path.
   * @returns `true` when a regular file exists there.
   */
  isFile(path: string): boolean
  /**
   * Read the Windows MSI `InstallDir` value for one app.
   * @param app - manifest whose display name keys the registry value.
   * @returns the install directory, or undefined when absent/unsupported.
   */
  registryInstallDir(app: CraftAppManifest): string | undefined
  /**
   * Read one Windows MSI `InstallDir` value by display name.
   * @param displayName - registry subkey name.
   * @returns the install directory, or undefined when absent/unsupported.
   */
  registryInstallDirFor?(displayName: string): string | undefined
  /**
   * List directory entry names.
   * @param path - absolute directory path.
   * @returns entry names, or empty when the directory is absent/unreadable.
   */
  listDir?(path: string): readonly string[]
  /**
   * List every Windows MSI `InstallDir` value.
   * @returns display name to install directory; empty off Windows.
   */
  registryInstallDirs?(): Readonly<Record<string, string>>
}

/** Local provider boundary beyond discovery. */
export interface CraftLocalIo {
  /** Discovery seam. */
  readonly discovery: CraftDiscoveryIo
  /**
   * Create one directory (and parents) when missing.
   * @param path - absolute directory path.
   */
  ensureDir(path: string): void
  /**
   * Write one secret file.
   * @param path - absolute file path.
   * @param data - file contents.
   */
  writeFile(path: string, data: string): void
  /**
   * Spawn one managed process tree.
   * @param spec - fully specified spawn request.
   * @returns the live handle.
   */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  /**
   * Report one contained, non-fatal teardown failure.
   * @param message - diagnostic text.
   */
  warn?(message: string): void
}

/** Resolved local provider configuration. */
export interface CraftLocalConfig {
  /** Per JSON-RPC request deadline in milliseconds. */
  readonly requestTimeoutMs: number
  /** Terminate escalation grace for a spawned app process tree. */
  readonly graceMs: number
  /** Bound on waiting for a terminated process to settle during close. */
  readonly closeGraceMs: number
}

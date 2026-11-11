/**
 * External application launching and OS file-manager reveal for host paths.
 *
 * The application table is a fixed catalogue of well-known editors and desktop
 * clients; which of them exist on a machine is probed at call time, never
 * configured. Launching never goes through a shell: every command is spawned
 * with an argv, and the path is passed as one argument.
 * @module @greeneek/gnk-native-command/external-app
 */

import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from './runner.ts'

/**
 * One launchable external application.
 *
 * `id` is the product vocabulary the Client localizes; a command name is never
 * an identifier. `commands` lists PATH candidates per platform in preference
 * order. `macAppName` and `bundleId` cover the macOS applications that ship
 * no command line, and `localAppDataPaths` covers the Windows installers that
 * register no PATH entry.
 */
export interface ExternalAppSpec {
  /** Stable application identity. */
  readonly id: string
  /** PATH command candidates per platform, in preference order. */
  readonly commands: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>>
  /** macOS application bundle name, without the `.app` suffix. */
  readonly macAppName: string
  /** macOS bundle identifier, used to open an installed application by id. */
  readonly bundleId: string
  /** Windows install locations relative to the user's local application data. */
  readonly localAppDataPaths: readonly string[]
}

/**
 * The external applications Greeneek offers for opening a workspace folder.
 *
 * The operating system's own file manager is not listed here: it is the
 * platform default and is reached through the ordinary path opener.
 */
export const EXTERNAL_APPS: readonly ExternalAppSpec[] = [
  {
    id: 'cursor',
    commands: { win32: ['cursor'], darwin: ['cursor'], linux: ['cursor'] },
    macAppName: 'Cursor',
    bundleId: 'com.todesktop.230313mzl4w4u92',
    localAppDataPaths: ['Programs/cursor/Cursor.exe'],
  },
  {
    id: 'vscode',
    commands: { win32: ['code'], darwin: ['code'], linux: ['code'] },
    macAppName: 'Visual Studio Code',
    bundleId: 'com.microsoft.VSCode',
    localAppDataPaths: ['Programs/Microsoft VS Code/Code.exe'],
  },
  {
    id: 'android-studio',
    commands: { win32: ['studio64'], darwin: ['studio'], linux: ['studio.sh'] },
    macAppName: 'Android Studio',
    bundleId: 'com.google.android.studio',
    localAppDataPaths: ['Programs/Android Studio/bin/studio64.exe'],
  },
  {
    id: 'github-desktop',
    commands: { win32: ['github'], darwin: ['github'], linux: ['github-desktop'] },
    macAppName: 'GitHub Desktop',
    bundleId: 'com.github.GitHubClient',
    localAppDataPaths: ['GitHubDesktop/GitHubDesktop.exe'],
  },
]

/** Injectable platform facts for deterministic adapter tests. */
export interface ExternalAppInternals {
  /** Host platform override. */
  platform?: NodeJS.Platform
  /** Environment used for PATH and LOCALAPPDATA lookups. */
  env?: NodeJS.ProcessEnv
  /** Command runner override. */
  run?: NativeCommandRunner
  /** Existence probe override for resolved executable paths. */
  exists?: (path: string) => boolean
}

/** One external application's availability on this host. */
export interface ExternalAppAvailability {
  /** Stable application identity. */
  readonly id: string
  /** True when the application can be launched on this host. */
  readonly available: boolean
}

/** Windows executable suffixes looked up when a PATH name carries none. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com']

/** Whether a name already addresses a file rather than a PATH entry. */
function isPathLike(name: string): boolean {
  return name.includes('/') || name.includes('\\')
}

/**
 * Join path segments the way the target platform spells them.
 *
 * The adapter can be asked about another platform than the host runs, so the
 * separator follows the requested platform instead of the host's.
 * @param platform - target platform.
 * @param segments - path segments to join.
 * @returns the joined path.
 */
function joinFor(platform: NodeJS.Platform, ...segments: string[]): string {
  if (platform === 'win32') return join(...segments)
  return segments.filter(segment => segment !== '').join('/')
}

/**
 * Resolve one command name to an executable path.
 * @param name - command name or path.
 * @param platform - host platform.
 * @param env - environment holding PATH and PATHEXT.
 * @param exists - existence probe.
 * @returns the resolved executable path, or undefined when nothing matches.
 */
function resolveExecutable(
  name: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): string | undefined {
  if (isPathLike(name)) return exists(name) ? name : undefined
  const pathValue = env.PATH ?? env.Path ?? ''
  const directories = pathValue.split(delimiter).filter(entry => entry !== '')
  const suffixes = platform === 'win32' ? WINDOWS_EXTENSIONS : ['']
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = joinFor(platform, directory, `${name}${suffix}`)
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Resolve one application to the executable that launches it.
 * @param spec - application catalogue entry.
 * @param internals - platform and existence seam.
 * @returns the resolved executable path, or undefined when none is reachable.
 */
function resolveAppExecutable(spec: ExternalAppSpec, internals: ExternalAppInternals): string | undefined {
  const platform = internals.platform ?? process.platform
  const env = internals.env ?? process.env
  const exists = internals.exists ?? existsSync
  for (const command of spec.commands[platform] ?? []) {
    const resolved = resolveExecutable(command, platform, env, exists)
    if (resolved !== undefined) return resolved
  }
  if (platform === 'win32') {
    const root = env.LOCALAPPDATA
    for (const relative of spec.localAppDataPaths) {
      if (root === undefined || root === '') continue
      const candidate = joinFor(platform, root, ...relative.split('/'))
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Whether one macOS application bundle is installed.
 * @param spec - application catalogue entry.
 * @param exists - existence probe.
 * @returns true when a bundle with the catalogue's name is present.
 */
function macBundleInstalled(spec: ExternalAppSpec, exists: (path: string) => boolean): boolean {
  return exists(`/Applications/${spec.macAppName}.app`)
    || exists(`/Applications/Utilities/${spec.macAppName}.app`)
}

/**
 * Report which catalogue applications this host can launch.
 * @param specs - catalogue entries to probe.
 * @param internals - platform and existence seam.
 * @returns one availability row per catalogue entry, in catalogue order.
 */
export function externalAppAvailability(
  specs: readonly ExternalAppSpec[],
  internals: ExternalAppInternals = {},
): ExternalAppAvailability[] {
  const platform = internals.platform ?? process.platform
  const exists = internals.exists ?? existsSync
  return specs.map((spec) => {
    if (resolveAppExecutable(spec, internals) !== undefined) {
      return { id: spec.id, available: true }
    }
    if (platform === 'darwin' && macBundleInstalled(spec, exists)) {
      return { id: spec.id, available: true }
    }
    return { id: spec.id, available: false }
  })
}

/**
 * Launch one external application with a host path.
 * @param appId - catalogue identity.
 * @param path - absolute path the application opens.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - platform, environment, and runner seam.
 * @throws Error when the application is unknown or is not installed.
 */
export async function launchExternalApp(
  appId: string,
  path: string,
  signal: AbortSignal,
  internals: ExternalAppInternals = {},
): Promise<void> {
  const spec = EXTERNAL_APPS.find(candidate => candidate.id === appId)
  if (spec === undefined) throw new Error(`unknown external application "${appId}"`)
  const platform = internals.platform ?? process.platform
  const exists = internals.exists ?? existsSync
  const run = internals.run ?? runNativeCommand
  signal.throwIfAborted()

  const executable = resolveAppExecutable(spec, internals)
  if (executable !== undefined) {
    await run(executable, [path], signal)
    return
  }
  if (platform === 'darwin') {
    if (macBundleInstalled(spec, exists)) {
      await run('open', ['-b', spec.bundleId, path], signal)
      return
    }
    throw new Error(`external application "${appId}" is not installed on this host`)
  }
  throw new Error(`external application "${appId}" is not installed on this host`)
}

/**
 * Whether one path is a directory on this host.
 * @param path - absolute path.
 * @returns true when the path names a directory.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // A missing, unreadable, or non-file path has no directory facts to reveal.
    return false
  }
}

/**
 * Reveal one path in the operating system's file manager.
 *
 * A directory is opened; a file is selected inside its folder. Linux has no
 * portable reveal, so the containing folder is opened there.
 * @param path - absolute path to reveal.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - platform, environment, and runner seam.
 */
export async function revealNativePath(
  path: string,
  signal: AbortSignal,
  internals: ExternalAppInternals = {},
): Promise<void> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand
  const directory = isDirectory(path)
  signal.throwIfAborted()

  if (platform === 'darwin') {
    await run('open', directory ? [path] : ['-R', path], signal)
    return
  }
  if (platform === 'win32') {
    await run('explorer.exe', directory ? [path] : [`/select,${path}`], signal)
    return
  }
  if (platform === 'linux') {
    await run('xdg-open', [directory ? path : joinFor(platform, path, '..')], signal)
    return
  }
  throw new Error(`native path reveal is unsupported on ${platform}`)
}

/**
 * Whether {@link revealNativePath} plausibly reaches a desktop on this host.
 * @param internals - platform and environment seam.
 * @returns true when the host can show a file manager at all.
 */
export function canRevealNativePath(internals: ExternalAppInternals = {}): boolean {
  const platform = internals.platform ?? process.platform
  if (platform === 'darwin' || platform === 'win32') return true
  if (platform !== 'linux') return false
  const env = internals.env ?? process.env
  const present = (value: string | undefined): boolean => value !== undefined && value !== ''
  return present(env.DISPLAY) || present(env.WAYLAND_DISPLAY)
}

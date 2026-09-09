/**
 * Window facts the About section reads: the preload bridge inside Greeneek
 * Desktop and the installed-version global every `gnk web` page injects.
 * Both are validated at the boundary — an absent or foreign global reads as
 * missing, never a crash.
 */

/** Subset of the preload bridge the About section calls. */
export interface DesktopBridge {
  /** Installed versions; harness is absent when the manifest is unreadable. */
  versions: () => Promise<{ desktop: string; harness?: unknown }>
  /** Current update state (one of the updater's UPDATE_STATES). */
  updateStatus: () => Promise<{ state: string }>
  /** User-invoked check; resolves to the fresh state. */
  checkForUpdates: () => Promise<{ state: string }>
  /** Restart into the downloaded update. */
  installUpdate: () => Promise<unknown>
}

/** Whether a window global quacks like the preload bridge. */
function isDesktopBridge(candidate: unknown): candidate is DesktopBridge {
  if (typeof candidate !== 'object' || candidate === null) return false
  const bridge = candidate as Record<string, unknown>
  return ['versions', 'updateStatus', 'checkForUpdates', 'installUpdate']
    .every(key => typeof bridge[key] === 'function')
}

/**
 * The preload bridge when the page runs inside Greeneek Desktop.
 * @returns the bridge, or `undefined` in a plain browser tab.
 */
export function desktopBridge(): DesktopBridge | undefined {
  const candidate = (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop
  return isDesktopBridge(candidate) ? candidate : undefined
}

/**
 * The installed Greeneek version injected by the web-app bundle.
 * @returns the version string, or `undefined` when absent or malformed.
 */
export function webVersion(): string | undefined {
  const version = (globalThis as { __GNK_VERSION__?: unknown }).__GNK_VERSION__
  return typeof version === 'string' && version !== '' ? version : undefined
}

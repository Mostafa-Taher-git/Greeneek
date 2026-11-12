/**
 * The web interface the desktop window loads in development.
 *
 * The desktop app serves the workspace's built web app, so a missing build
 * leaves the window blank. The launcher checks for the entry file before the
 * window opens and builds it when it is absent.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The workspace-relative web app the desktop window loads in development. */
export const WEB_APP_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web')

/** The entry file the built web app serves. */
export const WEB_APP_ENTRY = resolve(WEB_APP_DIRECTORY, 'dist', 'index.html')

/**
 * Whether the built web interface is present.
 * @param entry - the built entry file.
 * @param exists - the file-existence probe.
 * @returns true when the interface can be served.
 */
export function webAppBuilt(entry = WEB_APP_ENTRY, exists = existsSync) {
  return exists(entry)
}

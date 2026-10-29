import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Version facts for the About section. Display-only helpers: an unreadable
 * manifest yields `undefined` and the row is omitted, never a boot failure.
 */

/**
 * Read a version string from a package directory's manifest.
 * @param dir - directory containing `package.json`.
 * @param readFileImpl - injectable file reader for tests.
 * @returns the version string, or `undefined` when missing or invalid.
 */
export function packageVersion(dir, readFileImpl = readFileSync) {
  try {
    const manifest = JSON.parse(readFileImpl(join(dir, 'package.json'), 'utf8'))
    return typeof manifest?.version === 'string' && manifest.version !== ''
      ? manifest.version
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The bundled harness version inside a staged app directory.
 * @param appDir - the staged app root (holds `node_modules/@greeneek/gnk`).
 * @param readFileImpl - injectable file reader for tests.
 * @returns the harness version, or `undefined` when it cannot be read.
 */
export function bundledHarnessVersion(appDir, readFileImpl = readFileSync) {
  return packageVersion(join(appDir, 'node_modules', '@greeneek', 'gnk'), readFileImpl)
}

/**
 * Desktop version the About section reports. Packaged builds carry the version
 * stamped from the release tag; an unpackaged source build is a development
 * build and says so instead of presenting the checked-in manifest as a release.
 * @param options - the Electron manifest version and packaged state.
 * @returns the display version, or `unknown` when the manifest value is empty.
 */
export function displayDesktopVersion({ appVersion, isPackaged }) {
  if (typeof appVersion !== 'string' || appVersion === '') return 'unknown'
  return isPackaged ? appVersion : `${appVersion}-dev`
}

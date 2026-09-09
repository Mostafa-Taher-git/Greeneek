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

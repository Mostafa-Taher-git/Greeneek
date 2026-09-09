import { readFile, rm, writeFile } from 'node:fs/promises'
import { bootHealthPath } from './paths.js'

/**
 * Boot-health counter: consecutive `gnk` service failures. At the threshold
 * the desktop retries in safe mode (core plugins only) instead of quitting.
 * A successful boot clears the count. Torn or missing files read as zero —
 * the counter must never block a launch itself.
 */

/** Consecutive boot failures that trigger safe mode. */
export const SAFE_MODE_FAILURE_THRESHOLD = 3

/**
 * Read the consecutive failure count.
 * @param userData - the app's userData directory.
 * @param readFileImpl - injectable file reader for tests.
 * @returns the count, or zero when missing or invalid.
 */
export async function readBootFailures(userData, readFileImpl = readFile) {
  try {
    const parsed = JSON.parse(await readFileImpl(bootHealthPath(userData), 'utf8'))
    return typeof parsed?.failures === 'number' && parsed.failures > 0
      ? Math.floor(parsed.failures)
      : 0
  } catch {
    return 0
  }
}

/**
 * Record one more consecutive failure.
 * @param userData - the app's userData directory.
 * @param deps - injectable file operations for tests.
 * @returns the new count.
 */
export async function recordBootFailure(userData, { readFileImpl = readFile, writeFileImpl = writeFile } = {}) {
  const failures = await readBootFailures(userData, readFileImpl) + 1
  await writeFileImpl(bootHealthPath(userData), JSON.stringify({ failures }), 'utf8')
  return failures
}

/**
 * Forget failures after a successful boot.
 * @param userData - the app's userData directory.
 * @param rmImpl - injectable file remover for tests.
 * @returns nothing.
 */
export async function clearBootFailures(userData, rmImpl = rm) {
  await rmImpl(bootHealthPath(userData), { force: true }).catch(() => undefined)
}

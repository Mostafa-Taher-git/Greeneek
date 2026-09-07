import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * pnpm store pinning for the desktop-booted profile.
 * pnpm records the store it linked `node_modules` from in `.modules.yaml` and
 * refuses every later operation (install AND uninstall) when the store it
 * would use now differs — `ERR_PNPM_UNEXPECTED_STORE`, a total plugin
 * lockout. Writing the recorded store into the profile's `.npmrc` keeps the
 * two accounts of the same fact from drifting. Never throws: a pin that
 * cannot be read or written is reported, never fatal to boot.
 */

/**
 * The store `node_modules` was linked from, as pnpm recorded it.
 * @param profileDirectory - the profile directory holding `node_modules`.
 * @returns the recorded store dir, or undefined when unreadable.
 */
export async function recordedStoreDir(profileDirectory) {
  try {
    const raw = await readFile(join(profileDirectory, 'node_modules', '.modules.yaml'), 'utf8')
    const quoted = /^\s*"?storeDir"?\s*:\s*"([^"]+)"/mu.exec(raw)
    const bare = /^\s*"?storeDir"?\s*:\s*([^"\s][^,\n]*?)\s*,?\s*$/mu.exec(raw)
    const value = (quoted?.[1] ?? bare?.[1])?.trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The store an `.npmrc` pins, if it pins one.
 * @param npmrc - the `.npmrc` text.
 * @returns the pinned store dir, or undefined when unpinned.
 */
export function configuredStoreDir(npmrc) {
  const value = /^\s*store-dir\s*=\s*(.+?)\s*$/mu.exec(npmrc)?.[1]
  return value ? value : undefined
}

/**
 * pnpm records the store including its version segment (`…/v10`); the setting
 * names the directory above it.
 * @param recorded - the recorded store dir.
 * @returns the value to pin in `.npmrc`.
 */
export function storeDirSetting(recorded) {
  return /[/\\]v\d+$/u.test(recorded) ? dirname(recorded) : recorded
}

/**
 * An `.npmrc` text pinning the recorded store, or undefined when it already
 * does — callers leave the file alone rather than rewriting every launch.
 * @param npmrc - the current `.npmrc` text.
 * @param storeDir - the store dir to pin.
 * @returns the text to write, or undefined when already pinned.
 */
export function pinStoreDir(npmrc, storeDir) {
  if (configuredStoreDir(npmrc) === storeDir) return undefined
  const newline = npmrc.includes('\r\n') ? '\r\n' : '\n'
  const body = configuredStoreDir(npmrc) === undefined
    ? npmrc
    : npmrc.replace(/^\s*store-dir\s*=.*(?:\r?\n|$)/mu, '')
  const separator = body.length === 0 || body.endsWith('\n') ? '' : newline
  return `${body}${separator}store-dir=${storeDir}${newline}`
}

async function writeFileAtomically(path, contents) {
  const temporary = `${path}.greeneek-desktop-${process.pid}-${Date.now()}.tmp`
  try {
    await writeFile(temporary, contents, 'utf8')
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

/**
 * Write the recorded store into the profile's `.npmrc`.
 * Only what pnpm already recorded is written — a profile that never installed
 * anything has nothing to state.
 * @param profileDirectory - the profile directory to pin.
 * @returns `{ pinned | already | skipped, reason? }`, never throws.
 */
export async function ensurePinnedStore(profileDirectory) {
  const recorded = await recordedStoreDir(profileDirectory)
  if (recorded === undefined) return { status: 'skipped', reason: 'no recorded store' }
  let npmrc = ''
  try {
    npmrc = await readFile(join(profileDirectory, '.npmrc'), 'utf8')
  } catch {
    // A profile without an .npmrc still deserves the pin.
  }
  const expected = storeDirSetting(recorded)
  const pinned = pinStoreDir(npmrc, expected)
  if (pinned === undefined) return { status: 'already' }
  try {
    await writeFileAtomically(join(profileDirectory, '.npmrc'), pinned)
    return { status: 'pinned' }
  } catch (error) {
    return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
  }
}

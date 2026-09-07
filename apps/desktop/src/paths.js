import { join } from 'node:path'

export const GNK_HOME_ENV = 'GNK_HOME'
export const HARNESS_DIR_NAME = 'harness'
export const LAUNCH_ROOT_DIR_NAME = 'launch-root'
export const UPDATE_SKIP_FILE_NAME = 'update-skip.json'
export const GNK_LOG_FILE_NAME = 'gnk.log'

/**
 * Where the desktop's harness home lives.
 * An exported, non-blank `$GNK_HOME` wins (lets CLI and desktop share a home
 * deliberately); otherwise the desktop isolates its data under userData so
 * reinstalls, upgrades, and CLI/desktop version skew cannot harm each other.
 * @param env - environment mapping used to read `GNK_HOME`.
 * @param userData - the app's userData directory.
 * @returns the directory to pass the child as `GNK_HOME`.
 */
export function resolveDesktopGnkHome(env, userData) {
  const fromEnv = env[GNK_HOME_ENV]
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(userData, HARNESS_DIR_NAME)
}

/**
 * Neutral working directory for the child process.
 * Never the install dir, never the home root: an app-owned scratch dir.
 * @param userData - the app's userData directory.
 * @returns the directory to pass the child as cwd.
 */
export function launchRootDir(userData) {
  return join(userData, LAUNCH_ROOT_DIR_NAME)
}

/**
 * Persistent log file for the desktop plus mirrored child output.
 * @param logsDir - the platform log directory.
 * @returns the log file path (the caller creates its parent).
 */
export function gnkLogPath(logsDir) {
  return join(logsDir, GNK_LOG_FILE_NAME)
}

/**
 * Remembered update choice (one skippable version).
 * @param userData - the app's userData directory.
 * @returns the skip-file path.
 */
export function updateSkipPath(userData) {
  return join(userData, UPDATE_SKIP_FILE_NAME)
}

/**
 * The web profile directory inside a harness home.
 * The store pin runs against this profile: it is the only profile the
 * desktop boots, so it is the only one whose pnpm store can lock out.
 * @param gnkHome - the harness home directory.
 * @returns the web profile directory path.
 */
export function webProfileDir(gnkHome) {
  return join(gnkHome, 'profiles', 'web')
}

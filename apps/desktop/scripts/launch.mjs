import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Development launcher for Greeneek Desktop (`pnpm run start`).
 *
 * The Electron binary switches to bare Node while `ELECTRON_RUN_AS_NODE` is
 * set, and VS Code-derived editors export it for every child process they
 * spawn. In that mode `import { app } from 'electron'` resolves to an empty
 * built-in stub and `require('electron')` resolves to the npm install stub
 * whose `module.exports` is the binary path string, so `src/main.js` fails to
 * link instead of opening a window. Stripping the variable keeps the child in
 * Electron's main process, where Electron answers the `electron` specifier
 * itself and the named imports in `src/main.js` link. The same variable is
 * already scrubbed from the gnk service child env in `src/gnk-service.js`.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Environment variable that forces the Electron binary into Node mode.
 */
export const ELECTRON_NODE_MODE_ENV_VAR = 'ELECTRON_RUN_AS_NODE'

/**
 * Case-insensitive lookup, because Windows reports environment names in the
 * casing the parent used (`electron_run_as_node` still forces Node mode).
 * @param {Record<string, string | undefined>} env - Environment to inspect.
 * @returns {string | undefined} The key present in `env`, if any.
 */
export function findElectronNodeModeVar(env) {
  return Object.keys(env).find((key) => key.toUpperCase() === ELECTRON_NODE_MODE_ENV_VAR)
}

/**
 * Copies an environment without the Node-mode switch.
 * @param {Record<string, string | undefined>} env - Environment to sanitize.
 * @returns {Record<string, string | undefined>} New object holding every other
 * variable; `env` is never mutated.
 */
export function sanitizeElectronLaunchEnv(env) {
  const sanitized = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== ELECTRON_NODE_MODE_ENV_VAR) {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * Resolves the Electron binary through the npm package, which exports the
 * installed executable path outside the Electron runtime.
 * @returns {string} Absolute path to the Electron executable.
 * @throws {Error} When the `electron` package is not installed for this app.
 */
export function resolveElectronBinary() {
  let binary
  try {
    binary = createRequire(import.meta.url)('electron')
  } catch (error) {
    throw new Error(`electron package is not installed for apps/desktop: ${error.message}`)
  }
  if (typeof binary !== 'string' || binary.length === 0) {
    throw new Error('the electron package did not report an Electron executable path')
  }
  return binary
}

/**
 * Spawns the app under Electron's main process.
 * @param {{ args?: string[], cwd?: string, env?: Record<string, string | undefined>,
 *   stdio?: 'inherit' | 'pipe', spawnFn?: Function }} [options] - App path and
 * flags after the executable, working directory, parent environment to
 * sanitize, child stdio mode, and spawn override for tests.
 * @returns {import('node:child_process').ChildProcess} The live Electron child.
 */
export function launchDesktopApp({
  args = [packageDir],
  cwd = packageDir,
  env = process.env,
  stdio = 'inherit',
  spawnFn = spawn,
} = {}) {
  return spawnFn(resolveElectronBinary(), args, {
    cwd,
    env: sanitizeElectronLaunchEnv(env),
    stdio,
  })
}

const isMainModule = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const forcedNodeVar = findElectronNodeModeVar(process.env)
  if (forcedNodeVar !== undefined) {
    console.log(`launch: clearing ${forcedNodeVar} so Electron runs its main process, not bare Node`)
  }
  const child = launchDesktopApp({ args: [packageDir, ...process.argv.slice(2)] })
  child.once('error', (error) => {
    console.error(`launch: ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    process.exitCode = signal === null ? (code ?? 1) : 1
  })
}

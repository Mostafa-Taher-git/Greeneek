import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * gnk child-process lifecycle: spawn the bundled real Node on the entry
 * wrapper, wait for the token URL plus a stable probe, mirror output to the
 * log, and stop the child on quit. Pure helpers stay unit-testable; only
 * `startGnkService` touches processes and the filesystem.
 */

/** `gnk web: <token-url>` on stdout, stopping before any `(LAN: …)` suffix. */
export const READY_PATTERN = /^gnk web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)/m
/** Marker the entry wrapper prints when the real CLI fails to load. */
export const ENTRY_FAILURE_MARKER = 'GNK entry failed'
/** How many trailing log lines a failure dialog may quote. */
export const FAILURE_LOG_TAIL_LINES = 40
/** Progress heartbeat while waiting for readiness. */
export const STARTUP_PROGRESS_INTERVAL_MS = 10_000
/** Probe interval inside the stability window. */
export const READINESS_PROBE_INTERVAL_MS = 250
/** A healthy probe must hold this long before navigation. */
export const READINESS_STABILITY_WINDOW_MS = 500

/**
 * Bundled real Node binary inside the staged app dir.
 * @param appDir - the staged app directory (`resources/app` packaged).
 * @param platform - `process.platform` (injectable for tests).
 * @returns the node binary path; throws naming it when absent.
 */
export function resolveNodeBinary(appDir, platform = process.platform) {
  const binary = join(appDir, 'node_modules', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
  if (!existsSync(binary)) {
    throw new Error(`Bundled Node.js runtime is missing: ${binary} (reinstall dependencies with lifecycle scripts enabled)`)
  }
  return binary
}

/**
 * Entry wrapper living inside the app dir, next to `node_modules`, so its
 * bare `koffi` import resolves.
 * @param appDir - the staged app directory.
 * @returns the wrapper path; throws naming it when absent.
 */
export function resolveNodeEntry(appDir) {
  const entry = join(appDir, 'src', 'gnk-node-entry.mjs')
  if (!existsSync(entry)) {
    throw new Error(`Desktop entry wrapper is missing: ${entry}`)
  }
  return entry
}

/**
 * The built CLI the wrapper imports.
 * @param appDir - the staged app directory.
 * @returns the CLI entry path; throws naming it when absent.
 */
export function resolveGnkEntry(appDir) {
  const entry = join(appDir, 'node_modules', '@greeneek', 'gnk', 'lib', 'bin.js')
  if (!existsSync(entry)) {
    throw new Error(`Built gnk CLI is missing: ${entry} (run \`pnpm run build\` before staging)`)
  }
  return entry
}

/**
 * Bundled pnpm CLI: the first layout the `pnpm` package ships.
 * @param appDir - the staged app directory.
 * @returns the pnpm entry path; throws naming it when absent.
 */
export function resolveBundledPnpmEntry(appDir) {
  for (const candidate of ['pnpm.cjs', 'pnpm.mjs']) {
    const entry = join(appDir, 'node_modules', 'pnpm', 'bin', candidate)
    if (existsSync(entry)) return entry
  }
  throw new Error(`Bundled pnpm CLI is missing under ${join(appDir, 'node_modules', 'pnpm', 'bin')}`)
}

/**
 * Directory holding the `pnpm`/`pnpm.cmd` shims driven by `GNK_DESKTOP_*`.
 * @param appDir - the staged app directory.
 * @returns the shim directory path.
 */
export function resolveBundledToolDirectory(appDir) {
  return join(appDir, 'assets', 'bin')
}

/**
 * `gnk web: <url>` capture, ignoring the optional LAN suffix.
 * @param output - accumulated child output.
 * @returns the token URL, or undefined while it has not printed.
 */
export function extractReadyUrl(output) {
  return READY_PATTERN.exec(output)?.[1]
}

/**
 * The `?token=` the captured URL carries; robust to format drift via URL
 * parsing rather than string slicing.
 * @param readyUrl - the captured readiness URL.
 * @returns the launch token, or undefined when unparsable.
 */
export function extractLaunchToken(readyUrl) {
  try {
    return new URL(readyUrl).searchParams.get('token') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Launcher flags first, inner app args after: `--profile/--patch` belong to
 * the launcher, everything from `--host` on belongs to the web app.
 * @param options - entry paths and platform.
 * @returns the argv for `node --expose-internals <wrapper> …`.
 */
export function buildGnkArgs({ nodeEntry, gnkEntry, platform = process.platform, patch }) {
  return [
    nodeEntry,
    gnkEntry,
    '--profile',
    'web',
    ...(patch !== undefined ? ['--patch', patch] : []),
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--no-open',
  ]
}

/**
 * Case-insensitive `PATH` lookup on Windows (an exact-case miss launches the
 * child with an empty PATH).
 * @param env - the environment mapping.
 * @param platform - `process.platform` (injectable for tests).
 * @returns the PATH key as spelled in `env`.
 */
export function resolveEnvironmentPathKey(env, platform = process.platform) {
  if (platform !== 'win32') return 'PATH'
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path'
}

/**
 * Child environment: scrubbed of Electron/Node loader inheritance, carrying
 * the desktop markers, the bundled pnpm, and the shim dir up front on PATH.
 * @param options - base env, dirs, entries, and platform.
 * @returns the child environment mapping.
 */
export function buildSpawnEnvironment({
  env,
  gnkHome,
  nodeExecutable,
  pnpmEntry,
  toolDirectory,
  platform = process.platform,
}) {
  const pathKey = resolveEnvironmentPathKey(env, platform)
  const separator = platform === 'win32' ? ';' : ':'
  const scrubbed = { ...env }
  delete scrubbed.NODE_OPTIONS
  delete scrubbed.NODE_PATH
  delete scrubbed.ELECTRON_RUN_AS_NODE
  return {
    ...scrubbed,
    [pathKey]: [toolDirectory, scrubbed[pathKey]].filter(Boolean).join(separator),
    GNK_HOME: gnkHome,
    GNK_DESKTOP: '1',
    GNK_DESKTOP_NODE_EXECUTABLE: nodeExecutable,
    GNK_DESKTOP_PNPM_CLI: pnpmEntry,
    NO_COLOR: '1',
    npm_config_side_effects_cache: 'false',
    PNPM_CONFIG_SIDE_EFFECTS_CACHE: 'false',
  }
}

/**
 * A probe counts when the token exists and the server answers below 500.
 * 401 means alive-but-unauthenticated, not failure.
 * @param status - the HTTP status from probing the token URL origin.
 * @param token - the captured launch token.
 * @returns whether the server is up.
 */
export function isProbeHealthy(status, token) {
  return token !== undefined && status >= 200 && status < 500
}

/**
 * Stability fold: readiness needs a continuously healthy window, not one
 * lucky probe — navigating on the regex line alone can race token minting.
 * @param readySince - when the current healthy streak started (or undefined).
 * @param healthy - whether this probe was healthy.
 * @param now - current timestamp.
 * @param windowMs - required streak length.
 * @returns the updated `{ readySince, ready }`.
 */
export function updateReadyStability(readySince, healthy, now, windowMs = READINESS_STABILITY_WINDOW_MS) {
  if (!healthy) return { readySince: undefined, ready: false }
  const since = readySince ?? now
  return { readySince: since, ready: now - since >= windowMs }
}

/**
 * Poll the token URL until the stability window holds or the timeout lapses.
 * @param options - url, liveness/token readers, timeout, fetch, interval.
 * @returns the ready URL.
 */
export async function waitForReady({
  url,
  isAlive,
  getToken,
  timeoutMs,
  fetchImpl = fetch,
  intervalMs = READINESS_PROBE_INTERVAL_MS,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs
  let readySince
  for (;;) {
    if (!isAlive()) throw new Error('gnk exited before it was ready')
    if (now() >= deadline) throw new Error(`gnk did not become ready within ${timeoutMs}ms`)
    let healthy = false
    try {
      const response = await fetchImpl(url, { redirect: 'manual' })
      healthy = isProbeHealthy(response.status, getToken())
    } catch {
      healthy = false
    }
    const stability = updateReadyStability(readySince, healthy, now())
    readySince = stability.readySince
    if (stability.ready) return url
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * Spawn the child and resolve once it is stably ready.
 * Pre-flights name the missing file instead of hanging; the entry-failure
 * marker short-circuits the timeout; exit and timeout failures quote the log
 * tail so the dialog states a cause.
 * @param options - binaries, env, dirs, timeouts, and log/progress hooks.
 * @returns `{ child, ready, stop, snapshot }`.
 */
export function startGnkService({
  appDir,
  gnkHome,
  launchDir,
  logPath,
  platform = process.platform,
  timeoutMs = platform === 'win32' ? 120_000 : 60_000,
  patch,
  onLog,
  onProgress,
  spawnImpl = spawn,
  fetchImpl = fetch,
}) {
  const nodeBinary = resolveNodeBinary(appDir, platform)
  const nodeEntry = resolveNodeEntry(appDir)
  const gnkEntry = resolveGnkEntry(appDir)
  const pnpmEntry = resolveBundledPnpmEntry(appDir)
  const toolDirectory = resolveBundledToolDirectory(appDir)

  mkdirSync(dirname(logPath), { recursive: true })
  const logStream = createWriteStream(logPath, { flags: 'a' })
  const tail = []
  const emit = (chunk) => {
    const text = chunk.toString()
    logStream.write(text)
    tail.push(text)
    while (tail.join('').length > 32_768) tail.shift()
    onLog?.(text)
  }

  const args = ['--expose-internals', ...buildGnkArgs({ nodeEntry, gnkEntry, platform, patch })]
  const child = spawnImpl(nodeBinary, args, {
    cwd: launchDir,
    env: buildSpawnEnvironment({
      env: process.env,
      gnkHome,
      nodeExecutable: nodeBinary,
      pnpmEntry,
      toolDirectory,
      platform,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: platform === 'win32',
  })

  let output = ''
  let readyUrl
  let getToken = () => undefined
  let failed
  const fail = (error) => {
    if (failed === undefined) failed = error
  }
  const inspect = (chunk) => {
    emit(chunk)
    output += chunk.toString()
    if (output.includes(ENTRY_FAILURE_MARKER)) {
      fail(new Error(`gnk entry failed to load.\n${tail.join('').slice(-4096)}`))
      return
    }
    const url = readyUrl ?? extractReadyUrl(output)
    if (url !== undefined && readyUrl === undefined) {
      readyUrl = url
      getToken = () => extractLaunchToken(url)
    }
  }
  child.stdout?.on('data', inspect)
  child.stderr?.on('data', inspect)
  child.once('error', (error) => fail(error))
  child.once('exit', (code, signal) => {
    fail(new Error(`gnk stopped before it was ready (code ${String(code)}, signal ${String(signal)}).\n${tail.join('').slice(-4096)}`))
  })

  let progressTimer
  if (onProgress !== undefined) {
    progressTimer = setInterval(onProgress, STARTUP_PROGRESS_INTERVAL_MS)
  }
  const stopProgress = () => {
    if (progressTimer !== undefined) clearInterval(progressTimer)
  }

  const ready = (async () => {
    const started = Date.now()
    try {
      for (;;) {
        if (failed !== undefined) throw failed
        if (readyUrl !== undefined) {
          const url = await waitForReady({
            url: readyUrl,
            isAlive: () => child.exitCode === null && failed === undefined,
            getToken,
            timeoutMs,
            fetchImpl,
          })
          return url
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (failed !== undefined) throw failed
        if (Date.now() - started >= timeoutMs) {
          try {
            if (child.exitCode === null) child.kill('SIGTERM')
          } catch {
            // Already gone; the error below carries the cause.
          }
          throw new Error(`gnk did not become ready within ${timeoutMs}ms.\n${tail.join('').slice(-4096)}`)
        }
      }
    } finally {
      stopProgress()
    }
  })()

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    stopProgress()
    try {
      if (child.exitCode === null) child.kill('SIGTERM')
    } catch {
      // Already gone; the exit handler settled the promise.
    }
    logStream.end()
  }

  const snapshot = () => tail.join('').split('\n').slice(-FAILURE_LOG_TAIL_LINES).join('\n')

  return { child, ready, stop, snapshot }
}

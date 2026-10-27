import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractLaunchToken, extractReadyUrl } from '../src/gnk-service.js'

/**
 * Smoke the packaged app tree from outside the build checkout. The release
 * runner points `--app-dir` at the unpacked builder output
 * (`dist/<platform>-unpacked/resources/app`), which is the tree the installer
 * and AppImage carry. It boots the real web profile with no inherited
 * `NODE_PATH`, checks the auth fence on the ready origin, and imports the
 * telemetry entry whose missing `@opentelemetry/otlp-transformer` edge made the
 * installed v0.3.6 build unlaunchable.
 */
const scriptDir = dirname(fileURLToPath(import.meta.url))

function fail(message) {
  throw new Error(message)
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value) fail(`${name} requires a value`)
  return value
}

async function main() {
  const appDir = resolve(argument('--app-dir', process.env.GNK_INSTALLED_APP_DIR ?? join(scriptDir, '..', '.staging', 'app')))
  const nodeBinary = join(appDir, 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
  const wrapper = join(appDir, 'src', 'gnk-node-entry.mjs')
  const gnkEntry = join(appDir, 'node_modules', '@greeneek', 'gnk', 'lib', 'bin.js')
  const pnpmEntry = join(appDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  if (!existsSync(nodeBinary)) fail(`installed node missing: ${nodeBinary}`)
  if (!existsSync(wrapper)) fail(`installed wrapper missing: ${wrapper}`)
  if (!existsSync(gnkEntry)) fail(`installed gnk entry missing: ${gnkEntry}`)

  // The telemetry package resolves its exporter, which resolves the transformer,
  // from inside the deployed tree. Importing both names from that package's
  // directory is the check the v0.3.6 artifact fails.
  const telemetry = spawnSync(nodeBinary, [
    '-e',
    "import('@greeneek/gnk-session-telemetry-otel').then(() => import('@opentelemetry/otlp-transformer')).then(() => console.log('telemetry-ok'))",
  ], {
    cwd: join(appDir, 'node_modules', '@greeneek', 'gnk-session-telemetry-otel'),
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (telemetry.status !== 0 || !`${telemetry.stdout}${telemetry.stderr}`.includes('telemetry-ok')) {
    fail(`installed telemetry graph does not load: ${telemetry.stderr || telemetry.stdout}`)
  }

  const scratch = mkdtempSync(join(tmpdir(), 'gnk-installed-smoke-'))
  const child = spawn(nodeBinary, [
    wrapper,
    gnkEntry,
    '--profile', 'web',
    '--host', '127.0.0.1',
    '--port', '0',
    '--no-open',
  ], {
    cwd: scratch,
    env: {
      ...process.env,
      GNK_HOME: join(scratch, 'harness'),
      GNK_DESKTOP_NODE_EXECUTABLE: nodeBinary,
      GNK_DESKTOP_PNPM_CLI: pnpmEntry,
      NODE_PATH: '',
      NODE_OPTIONS: '',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
      try { child.kill('SIGTERM') } catch {}
      await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))])
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL') } catch {}
        await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))])
      }
    }
    // Windows keeps a directory busy for a moment after the process that used
    // it as cwd exits. Retry, and do not turn a successful smoke into a
    // failure because the scratch directory is still locked.
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch (error) {
      console.warn(`smoke-installed: scratch cleanup skipped: ${error.message}`)
    }
  }
  let output = ''
  try {
    const readyUrl = await new Promise((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error('installed service did not print readiness within 90s')), 90_000)
      const inspect = (chunk) => {
        output += chunk.toString()
        const url = extractReadyUrl(output)
        if (url !== undefined) {
          clearTimeout(timer)
          resolveUrl(url)
        }
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`installed service exited during boot (code ${String(code)}):\n${output.slice(-2048)}`))
      })
    })
    if (extractLaunchToken(readyUrl) === undefined) fail('installed readiness URL carries no launch token')

    // Plain fetch keeps no cookie jar, so the mint hop and the authenticated
    // hop are separate; the bare origin must still refuse.
    const minted = await fetch(readyUrl, { redirect: 'manual' })
    const setCookie = minted.headers.get('set-cookie') ?? ''
    if (![301, 302, 303, 307, 308].includes(minted.status) || !/gnk-auth-/.test(setCookie)) {
      fail(`installed token URL answers ${minted.status} without minting the auth cookie`)
    }
    const page = await fetch(new URL(readyUrl).origin, { headers: { cookie: setCookie.split(';')[0] } })
    if (page.status !== 200 || !(await page.text()).includes('__GNK_BOOT__')) {
      fail(`installed authed origin answers ${page.status} without the boot marker`)
    }
    const bare = await fetch(new URL(readyUrl).origin, { redirect: 'manual' })
    if (bare.status !== 401) fail(`installed bare origin answers ${bare.status}, expected 401`)

    console.log('smoke-installed: telemetry graph loads, the auth fence holds, and the packaged web profile is ready')
  } finally {
    await cleanup()
  }
}

await main().catch((error) => {
  console.error(`smoke-installed: ${error.message}`)
  process.exitCode = 1
})

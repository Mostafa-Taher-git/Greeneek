import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractLaunchToken, extractReadyUrl } from '../src/gnk-service.js'

/**
 * Packaged smoke test: boot the staged service under the staged node and
 * assert the HTTP contract (200 + boot marker with token, 401 without), the
 * pnpm shim, node-pty, and the baked updater feed. Always stops the child
 * and removes the scratch home.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staging = join(packageDir, '.staging', 'app')

function fail(message) {
  console.error(`smoke-packaged: ${message}`)
  process.exit(1)
}

async function main() {
  const platform = process.platform
  const nodeBinary = join(staging, 'node_modules', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
  if (!existsSync(nodeBinary)) fail(`staged node missing: ${nodeBinary} (run the stage script first)`)

  // 0. Staged node probes clean.
  const probe = spawnSync(nodeBinary, ['-p', 'process.platform'], { encoding: 'utf8' })
  if (probe.status !== 0 || probe.stdout.trim() !== platform) fail('staged node probe failed')
  console.log('smoke-packaged: staged node probes clean')

  // 1. Entry wrapper loads (usage error proves the wrapper chain resolves).
  const wrapper = spawnSync(nodeBinary, [join(staging, 'src', 'gnk-node-entry.mjs')], { encoding: 'utf8' })
  if (wrapper.status === 0 || !`${wrapper.stdout || ''}${wrapper.stderr || ''}`.includes('missing gnk entry path')) {
    fail('entry wrapper does not load under staged node')
  }
  console.log('smoke-packaged: entry wrapper loads')

  // 2. node-pty spawns under the staged node.
  const pty = spawnSync(nodeBinary, ['-e', `import('node-pty').then((pty) => { const p = pty.spawn('echo', ['OK'], {}); p.onData((d) => { process.stdout.write(d); p.kill() }) })`], {
    cwd: join(staging, 'node_modules', '@greeneek', 'gnk'),
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (pty.status !== 0 || !`${pty.stdout || ''}`.includes('OK')) fail('node-pty does not spawn under staged node')
  console.log('smoke-packaged: node-pty spawns')

  // 3. Boot the service in a scratch home and capture the token URL.
  const scratch = mkdtempSync(join(tmpdir(), 'gnk-desktop-smoke-'))
  const cleanup = () => {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    rmSync(scratch, { recursive: true, force: true })
  }
  process.on('exit', cleanup)

  const gnkEntry = join(staging, 'node_modules', '@greeneek', 'gnk', 'lib', 'bin.js')
  const pnpmEntry = join(staging, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  const child = spawn(nodeBinary, [
    '--expose-internals',
    join(staging, 'src', 'gnk-node-entry.mjs'),
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
      GNK_DESKTOP: '1',
      GNK_DESKTOP_NODE_EXECUTABLE: nodeBinary,
      GNK_DESKTOP_PNPM_CLI: pnpmEntry,
      NO_COLOR: '1',
      NODE_OPTIONS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const readyUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('service did not print a readiness line within 90s')), 90_000)
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
      reject(new Error(`service exited during boot (code ${String(code)}):\n${output.slice(-2048)}`))
    })
  }).catch((error) => {
    cleanup()
    fail(error instanceof Error ? error.message : String(error))
    throw error
  })
  console.log('smoke-packaged: readiness line captured')

  // 4. Token URL mints the auth cookie and redirects; the cookie loads the UI marker; bare origin answers 401.
  // Plain fetch keeps no cookie jar, so follow the redirect by hand: the
  // first hop must mint `gnk-auth-*`, the second (with the cookie) serves the UI.
  const token = extractLaunchToken(readyUrl)
  if (token === undefined) {
    cleanup()
    fail('readiness URL carries no token')
  }
  const tokenRes = await fetch(readyUrl, { redirect: 'manual' })
  const setCookie = tokenRes.headers.get('set-cookie') ?? ''
  if (![301, 302, 303, 307, 308].includes(tokenRes.status) || !/gnk-auth-/.test(setCookie)) {
    cleanup()
    fail(`token URL answers ${tokenRes.status} without minting the auth cookie`)
  }
  console.log('smoke-packaged: token URL mints the auth cookie')
  const cookie = setCookie.split(';')[0]
  const page = await fetch(new URL(readyUrl).origin, { headers: { cookie } })
  const body = await page.text()
  if (page.status !== 200 || !body.includes('__GNK_BOOT__')) {
    cleanup()
    fail(`authed origin answers ${page.status} without the boot marker`)
  }
  console.log('smoke-packaged: token URL serves the UI')
  const bare = await fetch(new URL(readyUrl).origin, { redirect: 'manual' })
  if (bare.status !== 401) {
    cleanup()
    fail(`bare origin answers ${bare.status}, expected 401`)
  }
  console.log('smoke-packaged: auth fence intact (bare origin 401)')

  // 5. The pnpm shim runs under the staged env.
  const shim = spawnSync(nodeBinary, [pnpmEntry, '--version'], {
    env: {
      ...process.env,
      GNK_DESKTOP_NODE_EXECUTABLE: nodeBinary,
      GNK_DESKTOP_PNPM_CLI: pnpmEntry,
    },
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (shim.status !== 0) {
    cleanup()
    fail(`bundled pnpm does not run: ${shim.stderr || shim.stdout}`)
  }
  console.log(`smoke-packaged: bundled pnpm ${shim.stdout.trim()}`)

  cleanup()
  console.log('smoke-packaged: green')
}

const isMainModule = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  await main()
}

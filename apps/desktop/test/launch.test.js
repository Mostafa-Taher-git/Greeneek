import { strict as assert } from 'node:assert'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ELECTRON_NODE_MODE_ENV_VAR,
  findElectronNodeModeVar,
  launchDesktopApp,
  resolveElectronBinary,
  sanitizeElectronLaunchEnv,
} from '../scripts/launch.mjs'

/**
 * Covers the development launch path. While the parent shell exports
 * `ELECTRON_RUN_AS_NODE`, the Electron binary runs as bare Node, `import
 * { app } from 'electron'` links against an empty stub, and `src/main.js`
 * never reaches `app.setName`. The launcher strips the variable, and the
 * fixture below repeats `src/main.js`'s named imports under a real main
 * process to prove the entry format itself is correct.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const startScript = join(packageDir, 'scripts', 'launch.mjs')
const fixtureDirs = []

let installedElectronBinary
try {
  installedElectronBinary = resolveElectronBinary()
} catch {
  installedElectronBinary = undefined
}
const electronAvailable = installedElectronBinary !== undefined && existsSync(installedElectronBinary)

/**
 * Named exports `src/main.js` imports from `electron`.
 * @returns {string[]} Specifier names in source order.
 */
function mainEntryExportNames() {
  const mainEntrySource = readFileSync(join(packageDir, 'src', 'main.js'), 'utf8')
  const namedImport = mainEntrySource.match(/import\s*\{([^}]+)\}\s*from\s*'electron'/u)
  assert.ok(
    namedImport,
    'src/main.js no longer statically imports named exports from electron; keep ESM named imports and update this fixture',
  )
  return namedImport[1].split(',').map((name) => name.trim()).filter(Boolean)
}

/**
 * Writes a throwaway Electron app whose entry mirrors `src/main.js`'s electron
 * import and records what the process actually was.
 * @returns {string} Absolute path of the temporary app directory.
 */
function createLaunchFixtureApp() {
  const exportNames = mainEntryExportNames()
  const appDir = mkdtempSync(join(tmpdir(), 'gnk-desktop-launch-'))
  fixtureDirs.push(appDir)
  writeFileSync(join(appDir, 'package.json'), `${JSON.stringify({
    name: 'gnk-desktop-launch-fixture',
    version: '0.0.0',
    private: true,
    type: 'module',
    main: 'main.js',
  }, null, 2)}\n`)
  writeFileSync(join(appDir, 'main.js'), `import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ${exportNames.join(',\n  ')},
} from 'electron'

writeFileSync(fileURLToPath(new URL('result.json', import.meta.url)), JSON.stringify({
  processType: process.type,
  electronVersion: process.versions.electron,
  exportTypes: [${exportNames.map((name) => `{ name: '${name}', type: typeof ${name} }`).join(', ')}],
}, null, 2))
process.exit(0)
`)
  return appDir
}

/**
 * Collects one child process to completion.
 * @param {import('node:child_process').ChildProcess} child - Process to watch.
 * @returns {Promise<{ code: number | null, signal: string | null, output: string }>}
 * Exit status plus merged stdout and stderr.
 */
function collect(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = ''
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.stderr?.on('data', (chunk) => { output += chunk })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => { resolvePromise({ code, signal, output }) })
  })
}

describe('launch environment', () => {
  it('drops the Node-mode switch whatever casing the parent used', () => {
    for (const key of [ELECTRON_NODE_MODE_ENV_VAR, 'electron_run_as_node', 'Electron_Run_As_Node']) {
      const env = sanitizeElectronLaunchEnv({ [key]: '1', PATH: '/usr/bin', NODE_OPTIONS: '--inspect' })
      assert.deepEqual(Object.keys(env), ['PATH', 'NODE_OPTIONS'])
      assert.equal(env.PATH, '/usr/bin')
      assert.equal(findElectronNodeModeVar({ [key]: '1' }), key)
    }
  })

  it('copies a clean environment without mutating the source', () => {
    const source = { PATH: '/usr/bin', GNK_HOME: '/h' }
    const sanitized = sanitizeElectronLaunchEnv(source)
    assert.deepEqual(sanitized, source)
    assert.notEqual(sanitized, source)
    assert.equal(findElectronNodeModeVar(source), undefined)
  })

  it('starts the app through the launcher, not a bare electron invocation', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    assert.equal(manifest.scripts.start, 'node scripts/launch.mjs')
    const launcherSource = readFileSync(startScript, 'utf8')
    assert.match(launcherSource, /launchDesktopApp\(\{ args: \[packageDir/u)
    assert.match(launcherSource, /process\.argv\.slice\(2\)/u)
  })

  it('reports the installed Electron executable', {
    skip: electronAvailable ? false : 'Electron binary is not installed',
  }, () => {
    assert.equal(resolveElectronBinary(), installedElectronBinary)
    assert.equal(existsSync(installedElectronBinary), true)
  })
})

describe('main-process entry load', {
  skip: electronAvailable ? false : `Electron binary is not installed at ${String(installedElectronBinary)}`,
}, () => {
  after(() => {
    for (const appDir of fixtureDirs) {
      rmSync(appDir, { recursive: true, force: true })
    }
    fixtureDirs.length = 0
  })

  it('links the main entry imports as an Electron browser process under a Node-mode host', async () => {
    const appDir = createLaunchFixtureApp()
    const child = launchDesktopApp({
      args: [appDir],
      env: { ...process.env, [ELECTRON_NODE_MODE_ENV_VAR]: '1' },
      stdio: 'pipe',
    })
    const { code, signal, output } = await collect(child)
    assert.equal(signal, null)
    assert.equal(code, 0, `Electron exited ${String(code)}:\n${output}`)

    const result = JSON.parse(readFileSync(join(appDir, 'result.json'), 'utf8'))
    assert.equal(result.processType, 'browser')
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    assert.equal(result.electronVersion, manifest.devDependencies.electron)
    assert.deepEqual(result.exportTypes.map((entry) => entry.name), mainEntryExportNames())
    assert.deepEqual(result.exportTypes.filter((entry) => entry.type === 'undefined'), [])
  })

  it('reproduces the Node-mode link failure the launcher prevents', async () => {
    const appDir = createLaunchFixtureApp()
    const result = spawnSync(installedElectronBinary, [appDir], {
      env: { ...process.env, [ELECTRON_NODE_MODE_ENV_VAR]: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    assert.equal(result.error, undefined, 'the Electron binary must start as Node to reproduce the defect')
    assert.equal(result.signal, null)
    assert.notEqual(result.status, 0, `Node mode must refuse the named imports:\n${output}`)
    assert.match(output, /does not provide an export named/u)
    assert.equal(existsSync(join(appDir, 'result.json')), false)
  })
})

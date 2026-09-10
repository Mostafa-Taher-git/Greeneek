import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const preload = join(here, '..', 'src', 'preload.cjs')

/**
 * The exact channel surface the web UI calls. Mirrors BRIDGE_CHANNELS in
 * desktop-bridge.js; the preload test below asserts the file exposes all of
 * these through the stubbed electron module.
 */
const EXPECTED_KEYS = [
  'checkForUpdates',
  'installUpdate',
  'updateStatus',
  'versions',
  'windowClose',
  'windowIsMaximized',
  'windowMinimize',
  'windowToggleMaximize',
]

/** Driver: loads the preload with only require('electron') stubbed — the sandboxed subset. */
const DRIVER = `
const Module = require('node:module')
const calls = []
const electronStub = {
  contextBridge: { exposeInMainWorld: (key, value) => calls.push([key, Object.keys(value).sort()]) },
  ipcRenderer: { invoke: () => Promise.resolve(undefined) },
}
const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub
  return originalLoad.call(this, request, ...rest)
}
try {
  require(process.argv[2])
} finally {
  Module._load = originalLoad
}
console.log(JSON.stringify(calls))
`

describe('preload bridge', () => {
  it('is plain script with no ESM imports (sandboxed preloads have no ESM context)', () => {
    const source = readFileSync(preload, 'utf8')
    assert.match(source, /require\('electron'\)/)
    assert.doesNotMatch(source, /^\s*import\s/m)
    assert.doesNotMatch(source, /^\s*export\s/m)
  })

  it('exposes every bridge channel through the stubbed electron module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'greeneek-preload-'))
    try {
      const driver = join(dir, 'driver.cjs')
      writeFileSync(driver, DRIVER)
      const result = spawnSync(process.execPath, [driver, preload], { encoding: 'utf8' })
      assert.equal(result.status, 0, `preload failed to load: ${result.stderr}`)
      const calls = JSON.parse(result.stdout)
      assert.deepEqual(calls, [['greeneekDesktop', EXPECTED_KEYS]])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

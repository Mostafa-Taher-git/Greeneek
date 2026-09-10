import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { BRIDGE_CHANNELS, registerDesktopBridge } from '../src/desktop-bridge.js'
import { resolveAutoUpdater } from '../src/updater.js'
import { bundledHarnessVersion, packageVersion } from '../src/versions.js'

function stageManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
}

describe('versions', () => {
  it('reads the version from a package manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'greeneek-versions-'))
    try {
      stageManifest(dir, { version: '1.1.0-alpha.0' })
      assert.equal(packageVersion(dir), '1.1.0-alpha.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('omits the version when the manifest is missing or invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'greeneek-versions-'))
    try {
      assert.equal(packageVersion(join(dir, 'absent')), undefined)
      stageManifest(dir, { version: 42 })
      assert.equal(packageVersion(dir), undefined)
      stageManifest(dir, { version: '' })
      assert.equal(packageVersion(dir), undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves the staged harness version under node_modules/@greeneek/gnk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'greeneek-versions-'))
    try {
      stageManifest(join(dir, 'node_modules', '@greeneek', 'gnk'), { version: '1.1.0-alpha.0' })
      assert.equal(bundledHarnessVersion(dir), '1.1.0-alpha.0')
      assert.equal(bundledHarnessVersion(join(dir, 'empty')), undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function fakeBridge() {
  const handlers = new Map()
  const calls = []
  const fakeWindow = {
    maximized: false,
    minimize() { calls.push('minimize') },
    maximize() { calls.push('maximize'); this.maximized = true },
    unmaximize() { calls.push('unmaximize'); this.maximized = false },
    close() { calls.push('close') },
    isMaximized() { return this.maximized },
  }
  const updateManager = {
    state: 'idle',
    checked: 0,
    installed: 0,
    getState() { return this.state },
    async checkForUpdates() {
      this.checked += 1
      this.state = 'checking'
    },
    quitAndInstall() { this.installed += 1 },
  }
  registerDesktopBridge({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    app: { getVersion: () => '0.1.0' },
    appDir: '/app',
    updateManager,
    readHarnessVersion: () => '1.1.0-alpha.0',
    getWindow: () => fakeWindow,
  })
  return { handlers, updateManager, calls, fakeWindow }
}

describe('desktop bridge', () => {
  it('registers exactly the preload channels', () => {
    const { handlers } = fakeBridge()
    assert.deepEqual([...handlers.keys()].sort(), [...BRIDGE_CHANNELS].sort())
  })

  it('answers versions, status, manual check, and install', async () => {
    const { handlers, updateManager } = fakeBridge()
    assert.deepEqual(await handlers.get('greeneek-desktop:versions')(), {
      desktop: '0.1.0',
      harness: '1.1.0-alpha.0',
    })
    assert.deepEqual(await handlers.get('greeneek-desktop:update-status')(), { state: 'idle' })
    assert.deepEqual(await handlers.get('greeneek-desktop:check-updates')(), { state: 'checking' })
    assert.equal(updateManager.checked, 1)
    await handlers.get('greeneek-desktop:install-update')()
    assert.equal(updateManager.installed, 1)
  })

  it('drives the frameless window controls through the window accessor', async () => {
    const { handlers, calls, fakeWindow } = fakeBridge()
    await handlers.get('greeneek-desktop:window-minimize')()
    assert.deepEqual(calls, ['minimize'])
    await handlers.get('greeneek-desktop:window-toggle-maximize')()
    assert.deepEqual(calls, ['minimize', 'maximize'])
    assert.deepEqual(await handlers.get('greeneek-desktop:window-is-maximized')(), { maximized: true })
    await handlers.get('greeneek-desktop:window-toggle-maximize')()
    assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize'])
    assert.deepEqual(await handlers.get('greeneek-desktop:window-is-maximized')(), { maximized: false })
    await handlers.get('greeneek-desktop:window-close')()
    assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize', 'close'])
    assert.equal(fakeWindow.maximized, false)
  })

  it('degrades update channels to unsupported without an update manager', async () => {
    const handlers = new Map()
    const calls = []
    registerDesktopBridge({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
      app: { getVersion: () => '0.1.0' },
      appDir: '/app',
      updateManager: undefined,
      readHarnessVersion: () => '1.1.0-alpha.0',
      getWindow: () => ({ minimize() { calls.push('minimize') } }),
    })
    assert.deepEqual(await handlers.get('greeneek-desktop:update-status')(), { state: 'unsupported' })
    assert.deepEqual(await handlers.get('greeneek-desktop:check-updates')(), { state: 'unsupported' })
    await handlers.get('greeneek-desktop:install-update')()
    assert.deepEqual(await handlers.get('greeneek-desktop:versions')(), {
      desktop: '0.1.0',
      harness: '1.1.0-alpha.0',
    })
    await handlers.get('greeneek-desktop:window-minimize')()
    assert.deepEqual(calls, ['minimize'])
  })
})

describe('resolveAutoUpdater', () => {
  const fake = { checkForUpdates() {} }

  it('takes the direct named export first', () => {
    assert.equal(resolveAutoUpdater({ autoUpdater: fake }), fake)
  })

  it('falls back to the default-exports object carrying the getter export', () => {
    assert.equal(resolveAutoUpdater({ default: { autoUpdater: fake } }), fake)
  })

  it('resolves to undefined without a usable updater', () => {
    assert.equal(resolveAutoUpdater({}), undefined)
    assert.equal(resolveAutoUpdater({ default: {} }), undefined)
    assert.equal(resolveAutoUpdater({ autoUpdater: {} }), undefined)
    assert.equal(resolveAutoUpdater(undefined), undefined)
  })
})

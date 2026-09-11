import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { clearStaleGnkAuthCookies, GNK_AUTH_COOKIE_PREFIX } from '../src/cookies.js'
import {
  gnkLogPath,
  launchRootDir,
  resolveDesktopGnkHome,
  bootHealthPath,
  updateSkipPath,
  webProfileDir,
} from '../src/paths.js'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/security.js'
import {
  configuredStoreDir,
  pinStoreDir,
  recordedStoreDir,
  storeDirSetting,
} from '../src/store-pin.js'
import {
  createUpdateManager,
  shouldOfferUpdate,
  updateCapabilities,
  UPDATE_STATES,
} from '../src/updater.js'
import { createTrayMenuTemplate, shouldHideWindowOnClose } from '../src/window-lifecycle.js'
import { createWindowOptions } from '../src/window-options.js'
import { FRAMELESS_TITLEBAR_CSS, FRAMELESS_TITLEBAR_HEIGHT, framelessTitlebarScript } from '../src/frameless-titlebar.js'
import { applyWindowsHide, enforceWindowsChildProcessHide } from '../src/gnk-windows-child-process-hide.mjs'

function fakeCookieStore(cookies) {
  const removed = []
  return {
    removed,
    async get() {
      return cookies
    },
    async remove(url, name) {
      removed.push([url, name])
    },
  }
}

describe('paths', () => {
  it('prefers an exported GNK_HOME and isolates by default', () => {
    assert.equal(resolveDesktopGnkHome({ GNK_HOME: '/shared/home' }, '/userData'), '/shared/home')
    assert.equal(resolveDesktopGnkHome({ GNK_HOME: '   ' }, '/userData'), '/userData/harness')
    assert.equal(resolveDesktopGnkHome({}, '/userData'), '/userData/harness')
  })

  it('lays out launch root, log, skip file, and web profile', () => {
    assert.equal(launchRootDir('/u'), '/u/launch-root')
    assert.equal(gnkLogPath('/logs'), '/logs/gnk.log')
    assert.equal(updateSkipPath('/u'), '/u/update-skip.json')
    assert.equal(bootHealthPath('/u'), '/u/boot-health.json')
    assert.equal(webProfileDir('/h'), '/h/profiles/web')
  })
})

describe('security', () => {
  it('trusts only loopback http(s) and file URLs', () => {
    assert.equal(isTrustedAppUrl('http://127.0.0.1:43117/?token=x'), true)
    assert.equal(isTrustedAppUrl('http://localhost:1/'), true)
    assert.equal(isTrustedAppUrl('file:///app/src/startup.html'), true)
    assert.equal(isTrustedAppUrl('https://github.com/'), false)
    assert.equal(isTrustedAppUrl('http://192.168.1.4:1/'), false)
    assert.equal(isTrustedAppUrl('not a url'), false)
  })

  it('grants only clipboard writes on the loopback main frame', () => {
    assert.equal(canGrantWindowPermission('clipboard-sanitized-write', 'http://127.0.0.1:1/', true), true)
    assert.equal(canGrantWindowPermission('notifications', 'http://127.0.0.1:1/', true), false)
    assert.equal(canGrantWindowPermission('clipboard-sanitized-write', 'http://127.0.0.1:1/', false), false)
    assert.equal(canGrantWindowPermission('clipboard-sanitized-write', 'https://x/', true), false)
    assert.equal(canGrantWindowPermission('clipboard-sanitized-write', undefined, true), false)
  })
})

describe('cookies', () => {
  it('removes only gnk-auth cookies for the loopback origin', async () => {
    const store = fakeCookieStore([
      { name: 'gnk-auth-aaa' },
      { name: 'gnk-auth-bbb' },
      { name: 'other' },
    ])
    const count = await clearStaleGnkAuthCookies(store, 'http://127.0.0.1:43117/?token=t')
    assert.equal(count, 2)
    assert.deepEqual(store.removed.map(([, name]) => name).sort(), ['gnk-auth-aaa', 'gnk-auth-bbb'])
    assert.ok(store.removed.every(([url]) => url === 'http://127.0.0.1:43117/'))
    assert.equal(GNK_AUTH_COOKIE_PREFIX, 'gnk-auth-')
  })

  it('refuses non-loopback URLs and malformed input', async () => {
    const store = fakeCookieStore([{ name: 'gnk-auth-aaa' }])
    assert.equal(await clearStaleGnkAuthCookies(store, 'https://example.com/'), 0)
    assert.equal(await clearStaleGnkAuthCookies(store, 'garbage'), 0)
    assert.deepEqual(store.removed, [])
  })
})

describe('store-pin', () => {
  it('reads the recorded store in quoted and bare layouts', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'gnk-desktop-pin-'))
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await writeFile(join(dir, 'node_modules', '.modules.yaml'), 'storeDir: "/s/v10",\n')
    assert.equal(await recordedStoreDir(dir), '/s/v10')
    await writeFile(join(dir, 'node_modules', '.modules.yaml'), 'storeDir: /plain\n')
    assert.equal(await recordedStoreDir(dir), '/plain')
  })

  it('returns undefined when nothing is recorded', async () => {
    assert.equal(await recordedStoreDir('/does/not/exist'), undefined)
  })

  it('parses and pins the store-dir setting idempotently', () => {
    assert.equal(configuredStoreDir('store-dir=/s\n'), '/s')
    assert.equal(configuredStoreDir('registry=x\n'), undefined)
    assert.equal(storeDirSetting('/s/v10'), '/s')
    assert.equal(storeDirSetting('/s'), '/s')
    assert.equal(pinStoreDir('store-dir=/s\n', '/s'), undefined)
    assert.equal(pinStoreDir('', '/s'), 'store-dir=/s\n')
    assert.equal(pinStoreDir('registry=x\n', '/s'), 'registry=x\nstore-dir=/s\n')
    assert.equal(pinStoreDir('store-dir=/old\n', '/s'), 'store-dir=/s\n')
  })
})

describe('updater policy', () => {
  // The manager drives offers through fire-and-forget async chains; poll for
  // the observable effect instead of sleeping a fixed number of ticks.
  const waitFor = async (cond, label) => {
    const deadline = Date.now() + 5000
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it('gates self-update by install location', () => {
    assert.deepEqual(
      updateCapabilities({ platform: 'win32', exePath: 'C:\\Program Files\\Greeneek\\Greeneek.exe', env: { ProgramFiles: 'C:\\Program Files' } }),
      { capable: true, kind: 'nsis' },
    )
    assert.equal(
      updateCapabilities({ platform: 'win32', exePath: 'D:\\portable\\Greeneek.exe', env: { ProgramFiles: 'C:\\Program Files' } }).capable,
      false,
    )
    assert.deepEqual(
      updateCapabilities({ platform: 'linux', exePath: '/tmp/app.AppImage', env: { APPIMAGE: '/tmp/app.AppImage' } }),
      { capable: true, kind: 'appimage' },
    )
    assert.equal(
      updateCapabilities({
        platform: 'linux',
        exePath: '/opt/greeneek/greeneek',
        env: {},
        execFileSyncImpl: () => { throw new Error('no dpkg') },
      }).capable,
      false,
    )
    assert.ok(UPDATE_STATES.includes('downloaded'))
  })

  it('detects deb installs by probing dpkg, and requires a privilege helper', () => {
    const dpkgOwns = (file) => {
      if (file === 'dpkg-query') return 'greeneek'
      throw new Error(`unexpected probe: ${file}`)
    }
    assert.deepEqual(
      updateCapabilities({
        platform: 'linux',
        exePath: '/opt/Greeneek/greeneek',
        env: {},
        execFileSyncImpl: (file) => {
          if (file === 'dpkg-query') return 'greeneek: /opt/Greeneek/greeneek'
          if (file === 'pkexec') return 'pkexec version 124'
          throw new Error(`unexpected probe: ${file}`)
        },
      }),
      { capable: true, kind: 'deb' },
    )
    // dpkg present but no pkexec: notify-only with a reason naming both options.
    const noPkexec = updateCapabilities({
      platform: 'linux',
      exePath: '/opt/Greeneek/greeneek',
      env: {},
      execFileSyncImpl: dpkgOwns,
    })
    assert.equal(noPkexec.capable, false)
    assert.equal(noPkexec.kind, 'none')
    assert.match(noPkexec.reason, /pkexec/)
    // An unpacked tarball under /opt is not package-managed: path alone never qualifies.
    assert.equal(
      updateCapabilities({
        platform: 'linux',
        exePath: '/opt/greeneek/greeneek',
        env: {},
        execFileSyncImpl: () => { throw new Error('not claimed') },
      }).kind,
      'none',
    )
  })

  it('re-offers skipped versions only on manual checks', () => {
    assert.equal(shouldOfferUpdate('1.0.0', '1.0.0', false), false)
    assert.equal(shouldOfferUpdate('1.0.0', '1.0.0', true), true)
    assert.equal(shouldOfferUpdate('1.0.1', '1.0.0', false), true)
  })

  it('offers Download & Install on capable installs and Download page elsewhere', async () => {
    const seen = []
    const dialog = { showMessageBox: async (options) => { seen.push(options); return { response: 2 } } }
    const events = new Map()
    const autoUpdater = {
      on: (name, listener) => events.set(name, listener),
      downloadUpdate: async () => undefined,
      quitAndInstall: () => undefined,
    }
    const app = { isPackaged: true, getPath: () => '/opt/Greeneek/greeneek', relaunch: () => undefined, exit: () => undefined }
    const execFileSyncImpl = (file) => {
      if (file === 'dpkg-query' || file === 'pkexec') return 'ok'
      throw new Error(`unexpected probe: ${file}`)
    }
    const manager = createUpdateManager({
      app,
      autoUpdater,
      dialog,
      shell: { openExternal: async () => undefined },
      log: undefined,
      userData: '/tmp/gnk-test-userdata',
      platform: 'linux',
      exePath: '/opt/Greeneek/greeneek',
      env: {},
      execFileImpl: async () => undefined,
      execFileSyncImpl,
    })
    // Simulate an available update, declining it: only the button labels matter here.
    await events.get('update-available')({ version: '0.2.9', releaseNotes: undefined })
    await waitFor(() => seen.length > 0, 'offer dialog')
    assert.deepEqual(seen[0].buttons, ['Download & Install', 'Skip this version', 'Later'])
    assert.equal(manager.getState(), 'idle')
    manager.stop()
  })

  it('installs a verified deb through the package manager, then relaunches', async () => {
    const spawned = []
    const dialogs = []
    const dialog = {
      showMessageBox: async (options) => {
        dialogs.push(options)
        // Accept every offer: download first, install on downloaded.
        return { response: 0 }
      },
    }
    const events = new Map()
    const relaunched = []
    const app = {
      isPackaged: true,
      getPath: () => '/opt/Greeneek/greeneek',
      relaunch: () => relaunched.push('relaunch'),
      exit: (code) => relaunched.push(`exit:${code}`),
    }
    const autoUpdater = {
      on: (name, listener) => events.set(name, listener),
      downloadUpdate: async () => undefined,
      quitAndInstall: () => { throw new Error('deb installs must not reach electron-updater install') },
    }
    const manager = createUpdateManager({
      app,
      autoUpdater,
      dialog,
      shell: { openExternal: async () => undefined },
      log: undefined,
      userData: '/tmp/gnk-test-userdata',
      platform: 'linux',
      exePath: '/opt/Greeneek/greeneek',
      env: {},
      execFileImpl: async (file, args) => {
        spawned.push([file, ...args])
        return ''
      },
      execFileSyncImpl: (file) => {
        if (file === 'dpkg-query' || file === 'pkexec') return 'ok'
        throw new Error(`unexpected probe: ${file}`)
      },
    })
    await events.get('update-available')({ version: '0.2.9', releaseNotes: undefined })
    await waitFor(() => dialogs.length > 0, 'download offer')
    await events.get('update-downloaded')({ version: '0.2.9', downloadedFile: '/tmp/Greeneek-0.2.9.deb' })
    await waitFor(() => dialogs.length > 1, 'install offer')
    // Offer, download offer, install offer: the install dialog names the privilege step.
    assert.equal(dialogs[1].buttons[0], 'Install now')
    assert.match(dialogs[1].detail, /administrator permission/)
    // The install offer already drove quitAndInstall: the flow installs, then relaunches.
    await waitFor(() => relaunched.length === 2, 'relaunch')
    // argv-based escalation of the verified file only — no shell, no downloaded code as root.
    assert.deepEqual(spawned, [['pkexec', 'apt-get', 'install', '--yes', '/tmp/Greeneek-0.2.9.deb']])
    assert.deepEqual(relaunched, ['relaunch', 'exit:0'])
    manager.stop()
  })

  it('falls back to the download page when the privileged install fails', async () => {
    const opened = []
    const dialog = { showMessageBox: async () => ({ response: 0 }) }
    const events = new Map()
    const app = {
      isPackaged: true,
      getPath: () => '/opt/Greeneek/greeneek',
      relaunch: () => { throw new Error('must not relaunch a failed install') },
      exit: () => undefined,
    }
    const manager = createUpdateManager({
      app,
      autoUpdater: {
        on: (name, listener) => events.set(name, listener),
        downloadUpdate: async () => undefined,
        quitAndInstall: () => undefined,
      },
      dialog,
      shell: { openExternal: async (url) => opened.push(url) },
      log: undefined,
      userData: '/tmp/gnk-test-userdata',
      platform: 'linux',
      exePath: '/opt/Greeneek/greeneek',
      env: {},
      execFileImpl: async () => { throw new Error('pkexec denied') },
      execFileSyncImpl: (file) => {
        if (file === 'dpkg-query' || file === 'pkexec') return 'ok'
        throw new Error(`unexpected probe: ${file}`)
      },
    })
    await events.get('update-available')({ version: '0.2.9', releaseNotes: undefined })
    await waitFor(() => opened.length > 0 || manager.getState() !== 'idle', 'download offer')
    await events.get('update-downloaded')({ version: '0.2.9', downloadedFile: '/tmp/Greeneek-0.2.9.deb' })
    await waitFor(() => opened.length > 0, 'download page fallback')
    assert.deepEqual(opened, ['https://github.com/Mostafa-Taher-git/Greeneek/releases/latest'])
    assert.equal(manager.getState(), 'idle')
    manager.stop()
  })
})

describe('window chrome', () => {
  it('hides to the tray instead of quitting', () => {
    assert.equal(shouldHideWindowOnClose(false, true), true)
    assert.equal(shouldHideWindowOnClose(true, true), false)
    assert.equal(shouldHideWindowOnClose(false, false), false)
  })

  it('labels the tray in English and Chinese, with an update row', () => {
    const en = createTrayMenuTemplate({ locale: 'en-US', showWindow: () => undefined })
    assert.deepEqual(
      en.map((row) => row.type ?? row.label),
      ['Open Greeneek', 'Open in Browser', 'Check for Updates', 'Hide Window', 'separator', 'Quit'],
    )
    const zh = createTrayMenuTemplate({ locale: 'zh-CN', updateAvailable: true })
    assert.ok(zh.some((row) => row.label === '重启并安装更新'))
  })

  it('runs frameless on Windows and Linux, framed elsewhere', () => {
    assert.equal(createWindowOptions('win32', false).frame, false)
    assert.equal(createWindowOptions('linux', false).frame, false)
    assert.equal(createWindowOptions('linux', true).backgroundColor, '#111813')
    assert.equal(createWindowOptions('linux', false).backgroundColor, '#fdfefa')
  })

  it('keeps the renderer sandboxed with no preload unless the bridge is attached', () => {
    const bare = createWindowOptions('linux', false)
    assert.equal(bare.webPreferences.sandbox, true)
    assert.equal(bare.webPreferences.nodeIntegration, false)
    assert.equal('preload' in bare.webPreferences, false)
    const bridged = createWindowOptions('linux', false, '/app/src/preload.cjs')
    assert.equal(bridged.webPreferences.preload, '/app/src/preload.cjs')
    assert.equal(bridged.webPreferences.sandbox, true)
  })

  it('paints the frameless strip with real-button controls, no native overlay', () => {
    assert.equal(FRAMELESS_TITLEBAR_HEIGHT, 40)
    assert.ok(FRAMELESS_TITLEBAR_CSS.includes('var(--dsw-alias-bg-base, Canvas)'))
    assert.ok(FRAMELESS_TITLEBAR_CSS.includes('#gnk-titlebar-controls'))
    assert.ok(FRAMELESS_TITLEBAR_CSS.includes('no-drag'))
    assert.ok(!FRAMELESS_TITLEBAR_CSS.includes('titlebar-area-'))
    const script = framelessTitlebarScript()
    assert.ok(script.includes('gnk-titlebar-controls'))
    assert.ok(script.includes('windowMinimize'))
    assert.ok(script.includes('windowToggleMaximize'))
    assert.ok(script.includes('windowClose'))
    assert.ok(script.includes('windowIsMaximized'))
    assert.ok(script.includes('__gnkTitlebarSync'))
    assert.ok(script.includes('apiOrWarn'))
    assert.ok(script.includes('preload bridge unavailable'))
  })
})

describe('windows child-process hide', () => {
  it('forces windowsHide unless explicitly chosen', () => {
    assert.deepEqual(applyWindowsHide(undefined), { windowsHide: true })
    assert.deepEqual(applyWindowsHide({}), { windowsHide: true })
    assert.deepEqual(applyWindowsHide({ windowsHide: false }), { windowsHide: false })
  })

  it('patches every spawn shape and syncs ESM exports', () => {
    const calls = []
    const fake = {
      spawn: (...args) => calls.push(['spawn', args]),
      spawnSync: (...args) => calls.push(['spawnSync', args]),
      exec: (...args) => calls.push(['exec', args]),
      execSync: (...args) => calls.push(['execSync', args]),
      execFile: (...args) => calls.push(['execFile', args]),
      execFileSync: (...args) => calls.push(['execFileSync', args]),
      fork: (...args) => calls.push(['fork', args]),
    }
    let synced = false
    enforceWindowsChildProcessHide(fake, () => {
      synced = true
    })
    fake.spawn('x', ['a'], {})
    fake.exec('x', () => undefined)
    assert.equal(synced, true)
    assert.deepEqual(calls[0][1][2], { windowsHide: true })
    assert.deepEqual(calls[1][1][1], { windowsHide: true })
  })
})

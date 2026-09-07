import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { clearStaleGnkAuthCookies, GNK_AUTH_COOKIE_PREFIX } from '../src/cookies.js'
import {
  gnkLogPath,
  launchRootDir,
  resolveDesktopGnkHome,
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
  shouldOfferUpdate,
  updateCapabilities,
  UPDATE_STATES,
} from '../src/updater.js'
import { createTrayMenuTemplate, shouldHideWindowOnClose } from '../src/window-lifecycle.js'
import { createWindowOptions } from '../src/window-options.js'
import { WINDOWS_TITLEBAR_CSS, WINDOWS_TITLEBAR_HEIGHT } from '../src/windows-titlebar.js'
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
  it('gates self-update by install location', () => {
    assert.deepEqual(
      updateCapabilities({ platform: 'win32', exePath: 'C:\\Program Files\\Greeneek\\Greeneek.exe', env: { ProgramFiles: 'C:\\Program Files' } }),
      { capable: true },
    )
    assert.equal(
      updateCapabilities({ platform: 'win32', exePath: 'D:\\portable\\Greeneek.exe', env: { ProgramFiles: 'C:\\Program Files' } }).capable,
      false,
    )
    assert.deepEqual(
      updateCapabilities({ platform: 'linux', exePath: '/tmp/app.AppImage', env: { APPIMAGE: '/tmp/app.AppImage' } }),
      { capable: true },
    )
    assert.equal(
      updateCapabilities({ platform: 'linux', exePath: '/opt/greeneek/greeneek', env: {} }).capable,
      false,
    )
    assert.ok(UPDATE_STATES.includes('downloaded'))
  })

  it('re-offers skipped versions only on manual checks', () => {
    assert.equal(shouldOfferUpdate('1.0.0', '1.0.0', false), false)
    assert.equal(shouldOfferUpdate('1.0.0', '1.0.0', true), true)
    assert.equal(shouldOfferUpdate('1.0.1', '1.0.0', false), true)
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

  it('hides the frame on Windows and keeps it on Linux', () => {
    assert.equal(createWindowOptions('win32', false).titleBarStyle, 'hidden')
    assert.equal(createWindowOptions('linux', true).titleBarStyle, 'default')
    assert.equal(createWindowOptions('linux', true).backgroundColor, '#111813')
    assert.equal(createWindowOptions('linux', false).backgroundColor, '#fdfefa')
  })

  it('paints the drag strip against the UI token with a system fallback', () => {
    assert.equal(WINDOWS_TITLEBAR_HEIGHT, 40)
    assert.ok(WINDOWS_TITLEBAR_CSS.includes('var(--dsw-alias-bg-base, Canvas)'))
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

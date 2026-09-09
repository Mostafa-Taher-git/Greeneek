import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron'
import { clearStaleGnkAuthCookies } from './cookies.js'
import { registerDesktopBridge } from './desktop-bridge.js'
import { startGnkService } from './gnk-service.js'
import {
  gnkLogPath,
  launchRootDir,
  resolveDesktopGnkHome,
  webProfileDir,
} from './paths.js'
import { secureWindow } from './security.js'
import { ensurePinnedStore } from './store-pin.js'
import { createUpdateManager } from './updater.js'
import { createTrayMenuTemplate, shouldHideWindowOnClose } from './window-lifecycle.js'
import { createWindowOptions } from './window-options.js'
import { applyWindowsTitleBarStyle } from './windows-titlebar.js'

/**
 * Greeneek Desktop main process: single-instance window, tray, and the gnk
 * child lifecycle. Boot order: lock → data dirs → store pin (best-effort,
 * the profile may not exist yet) → tray → window+splash → security → service
 * → cookies → token URL → store pin again → update manager.
 */

const APP_NAME = 'Greeneek'
const STARTUP_PAGE = fileURLToPath(new URL('./startup.html', import.meta.url))
const PRELOAD_SCRIPT = fileURLToPath(new URL('./preload.js', import.meta.url))
const TRAY_ICON = fileURLToPath(new URL('../assets/tray.png', import.meta.url))

app.setName(APP_NAME)

// Dev builds keep their data apart from packaged runs.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

let mainWindow
let tray
let trayAvailable = false
let isQuitting = false
let service
let serviceUrl
let updateManager

async function showMainWindow() {
  if (!mainWindow) {
    await createWindow()
    if (serviceUrl) await mainWindow?.loadURL(serviceUrl)
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function openInBrowser() {
  try {
    const url = serviceUrl ?? await service?.ready
    if (url) await shell.openExternal(url)
  } catch (error) {
    console.warn(`Could not open Greeneek in the browser: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function refreshTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    locale: app.getLocale(),
    updateAvailable: updateManager?.getState() === 'downloaded',
    showWindow: () => void showMainWindow(),
    openInBrowser: () => void openInBrowser(),
    checkForUpdates: () => void updateManager?.checkForUpdates({ manual: true }),
    hideWindow: () => mainWindow?.hide(),
    quit: () => {
      isQuitting = true
      app.quit()
    },
  })))
}

function createWindow() {
  if (process.platform === 'win32') Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow(createWindowOptions(process.platform, nativeTheme.shouldUseDarkColors, PRELOAD_SCRIPT))

  if (process.platform === 'win32') {
    mainWindow.setMenu(null)
    mainWindow.setMenuBarVisibility(false)
  }

  secureWindow(mainWindow.webContents, shell)

  mainWindow.webContents.on('did-finish-load', () => {
    if (process.platform === 'win32') void applyWindowsTitleBarStyle(mainWindow.webContents)
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (!shouldHideWindowOnClose(isQuitting, trayAvailable)) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  return mainWindow.loadFile(STARTUP_PAGE)
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON))
  tray.setToolTip(APP_NAME)
  refreshTrayMenu()
  tray.on('click', () => void showMainWindow())
  trayAvailable = true
}

async function launch() {
  const userData = app.getPath('userData')
  const gnkHome = resolveDesktopGnkHome(process.env, userData)
  const launchRoot = launchRootDir(userData)
  const logPath = gnkLogPath(app.getPath('logs'))
  mkdirSync(launchRoot, { recursive: true })
  mkdirSync(gnkHome, { recursive: true })

  // Best-effort before start: the profile may not exist until first boot.
  await ensurePinnedStore(webProfileDir(gnkHome))

  const startupReady = createWindow()
  try {
    createTray()
  } catch (error) {
    console.warn(`System tray is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  service = startGnkService({
    appDir: fileURLToPath(new URL('..', import.meta.url)),
    gnkHome,
    launchDir: launchRoot,
    logPath,
    onProgress: () => console.log('gnk service is starting…'),
  })

  try {
    serviceUrl = await service.ready
    await startupReady
    await clearStaleGnkAuthCookies(mainWindow.webContents.session.cookies, serviceUrl)
    await mainWindow?.loadURL(serviceUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({
      type: 'error',
      title: `${APP_NAME} failed to start`,
      message: 'Greeneek could not start.',
      detail: `${message}\n\nFull output is in the log file.`,
    })
    app.quit()
    return
  }

  // Second attempt now that the profile exists.
  await ensurePinnedStore(webProfileDir(gnkHome))

  updateManager = createUpdateManager({
    app,
    autoUpdater: (await import('electron-updater')).autoUpdater,
    dialog,
    shell,
    userData,
  })
  updateManager.setPrepareToInstall(async () => {
    service?.stop()
  })
  registerDesktopBridge({
    ipcMain,
    app,
    appDir: fileURLToPath(new URL('..', import.meta.url)),
    updateManager,
  })
  updateManager.onStateChange(() => refreshTrayMenu())
  updateManager.start()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void showMainWindow()
  })

  app.whenReady().then(launch)
}

app.on('activate', () => {
  void showMainWindow()
})

app.on('window-all-closed', () => {
  if (isQuitting || !trayAvailable) app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  try {
    updateManager?.stop()
  } catch {
    // Update manager teardown must never block quit.
  }
  service?.stop()
})

// Exported for tests that import the module graph without launching.
export { APP_NAME }

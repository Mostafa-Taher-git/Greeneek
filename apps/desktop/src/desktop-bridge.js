import { bundledHarnessVersion } from './versions.js'

/**
 * Renderer bridge wiring: version facts plus the consent-based update flow.
 * All Electron objects arrive as arguments so the channel contract stays
 * unit-testable with fakes; main.js supplies the live objects.
 */

/** IPC channels the preload bridge may call. */
export const BRIDGE_CHANNELS = [
  'greeneek-desktop:versions',
  'greeneek-desktop:update-status',
  'greeneek-desktop:check-updates',
  'greeneek-desktop:install-update',
  'greeneek-desktop:window-minimize',
  'greeneek-desktop:window-toggle-maximize',
  'greeneek-desktop:window-close',
  'greeneek-desktop:window-is-maximized',
]

/**
 * Register the renderer bridge on an ipcMain-like handler table.
 * The update manager is optional and may not exist yet at registration time:
 * the bridge must be wired before the window's first page load (the injected
 * frameless controls invoke channels from `did-finish-load`), while the
 * update manager only exists after the service boots. Pass it through
 * `getUpdateManager` for late binding, or directly when it already exists
 * (tests). Without a manager the update channels degrade to `unsupported`
 * (a state the UI already renders) while versions and window controls keep
 * working.
 * @param options - ipcMain, app, staged app dir, a update-manager accessor
 * or manager, a harness version reader, and a window accessor for the
 * frameless controls (optional in tests).
 * @returns nothing.
 */
export function registerDesktopBridge({
  ipcMain,
  app,
  appDir,
  updateManager,
  getUpdateManager,
  readHarnessVersion = bundledHarnessVersion,
  getWindow = () => undefined,
}) {
  const manager = () => getUpdateManager?.() ?? updateManager
  ipcMain.handle('greeneek-desktop:versions', () => ({
    desktop: app.getVersion(),
    harness: readHarnessVersion(appDir),
  }))
  ipcMain.handle('greeneek-desktop:update-status', () => ({
    state: manager()?.getState() ?? 'unsupported',
  }))
  ipcMain.handle('greeneek-desktop:check-updates', async () => {
    const updateManagerLike = manager()
    if (updateManagerLike === undefined) return { state: 'unsupported' }
    await updateManagerLike.checkForUpdates({ manual: true })
    return { state: updateManagerLike.getState() }
  })
  ipcMain.handle('greeneek-desktop:install-update', () => {
    manager()?.quitAndInstall()
  })
  ipcMain.handle('greeneek-desktop:window-minimize', () => {
    getWindow()?.minimize()
  })
  ipcMain.handle('greeneek-desktop:window-toggle-maximize', () => {
    const window = getWindow()
    if (window === undefined) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.handle('greeneek-desktop:window-close', () => {
    getWindow()?.close()
  })
  ipcMain.handle('greeneek-desktop:window-is-maximized', () => ({
    maximized: getWindow()?.isMaximized() === true,
  }))
}

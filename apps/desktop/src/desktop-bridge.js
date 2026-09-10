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
 * The update manager is optional: without one the update channels degrade
 * to `unsupported` (a state the UI already renders) while versions and
 * window controls keep working.
 * @param options - ipcMain, app, staged app dir, the update manager, and a
 * window accessor for the frameless controls (optional in tests).
 * @returns nothing.
 */
export function registerDesktopBridge({
  ipcMain,
  app,
  appDir,
  updateManager,
  readHarnessVersion = bundledHarnessVersion,
  getWindow = () => undefined,
}) {
  ipcMain.handle('greeneek-desktop:versions', () => ({
    desktop: app.getVersion(),
    harness: readHarnessVersion(appDir),
  }))
  ipcMain.handle('greeneek-desktop:update-status', () => ({
    state: updateManager?.getState() ?? 'unsupported',
  }))
  ipcMain.handle('greeneek-desktop:check-updates', async () => {
    if (updateManager === undefined) return { state: 'unsupported' }
    await updateManager.checkForUpdates({ manual: true })
    return { state: updateManager.getState() }
  })
  ipcMain.handle('greeneek-desktop:install-update', () => {
    updateManager?.quitAndInstall()
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

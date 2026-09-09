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
]

/**
 * Register the renderer bridge on an ipcMain-like handler table.
 * @param options - ipcMain, app, staged app dir, and the update manager.
 * @returns nothing.
 */
export function registerDesktopBridge({
  ipcMain,
  app,
  appDir,
  updateManager,
  readHarnessVersion = bundledHarnessVersion,
}) {
  ipcMain.handle('greeneek-desktop:versions', () => ({
    desktop: app.getVersion(),
    harness: readHarnessVersion(appDir),
  }))
  ipcMain.handle('greeneek-desktop:update-status', () => ({
    state: updateManager.getState(),
  }))
  ipcMain.handle('greeneek-desktop:check-updates', async () => {
    await updateManager.checkForUpdates({ manual: true })
    return { state: updateManager.getState() }
  })
  ipcMain.handle('greeneek-desktop:install-update', () => {
    updateManager.quitAndInstall()
  })
}

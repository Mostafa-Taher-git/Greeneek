import { WINDOWS_TITLEBAR_HEIGHT } from './windows-titlebar.js'

/**
 * Window geometry and chrome per platform.
 * Windows hides the native frame in favor of the overlay drag strip (Phase 3
 * paints it); Linux keeps its native titlebar.
 * @param platform - `process.platform` (injectable for tests).
 * @param useDarkColors - whether the OS reports a dark theme.
 * @param preload - preload script path for the About/update bridge, if any.
 * @returns the Electron BrowserWindow options.
 */
export function createWindowOptions(platform = process.platform, useDarkColors = false, preload = undefined) {
  const isWindows = platform === 'win32'
  return {
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Greeneek',
    backgroundColor: useDarkColors ? '#111813' : '#fdfefa',
    titleBarStyle: isWindows ? 'hidden' : 'default',
    titleBarOverlay: isWindows
      ? {
        color: '#00000000',
        symbolColor: useDarkColors ? '#e4ece1' : '#22392c',
        height: WINDOWS_TITLEBAR_HEIGHT,
      }
      : false,
    autoHideMenuBar: isWindows,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(preload === undefined ? {} : { preload }),
    },
  }
}

/**
 * Window geometry and chrome per platform.
 * Windows and Linux run frameless with the injected custom titlebar (small
 * controls top-right); anything else keeps its native frame.
 * @param platform - `process.platform` (injectable for tests).
 * @param useDarkColors - whether the OS reports a dark theme.
 * @param preload - preload script path for the About/update bridge, if any.
 * @returns the Electron BrowserWindow options.
 */
export function createWindowOptions(platform = process.platform, useDarkColors = false, preload = undefined) {
  const frameless = platform === 'win32' || platform === 'linux'
  return {
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Greeneek',
    backgroundColor: useDarkColors ? '#111813' : '#fdfefa',
    frame: !frameless,
    titleBarStyle: frameless ? 'hidden' : 'default',
    autoHideMenuBar: frameless,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(preload === undefined ? {} : { preload }),
    },
  }
}

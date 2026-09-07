/**
 * Close-to-tray rule and the tray menu template (English + Chinese mirrors).
 * @param isQuitting - whether the app is quitting (close then quits).
 * @param hasTray - whether a tray icon exists to hide behind.
 * @returns true when the window should hide instead of closing.
 */
export function shouldHideWindowOnClose(isQuitting, hasTray = true) {
  return !isQuitting && hasTray
}

/**
 * Tray menu rows; the update row degrades to a no-op dialog in dev builds.
 * @param options - locale, update label state, and the row actions.
 * @returns the Electron menu template.
 */
export function createTrayMenuTemplate({
  locale = 'en',
  updateAvailable = false,
  showWindow,
  openInBrowser,
  checkForUpdates,
  hideWindow,
  quit,
}) {
  const isChinese = locale.toLowerCase().startsWith('zh')
  return [
    {
      label: isChinese ? '打开 Greeneek' : 'Open Greeneek',
      click: showWindow,
    },
    {
      label: isChinese ? '在浏览器中打开' : 'Open in Browser',
      click: openInBrowser,
    },
    {
      label: updateAvailable
        ? (isChinese ? '重启并安装更新' : 'Restart and Install Update')
        : (isChinese ? '检查更新' : 'Check for Updates'),
      click: checkForUpdates,
    },
    {
      label: isChinese ? '隐藏窗口' : 'Hide Window',
      click: hideWindow,
    },
    { type: 'separator' },
    {
      label: isChinese ? '退出' : 'Quit',
      click: quit,
    },
  ]
}

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
 * Desktop-only tray menu rows.
 * @param options - locale and the desktop lifecycle actions.
 * @returns the Electron menu template.
 */
export function createTrayMenuTemplate({
  locale = 'en',
  showWindow,
  quit,
}) {
  const isChinese = locale.toLowerCase().startsWith('zh')
  return [
    {
      label: isChinese ? '打开 Greeneek' : 'Open Greeneek',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: isChinese ? '退出' : 'Quit',
      click: quit,
    },
  ]
}

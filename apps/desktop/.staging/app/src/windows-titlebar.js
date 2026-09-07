/**
 * Windows hidden-frame chrome: a 40 px drag strip overlaid on the web UI.
 * The page background comes from the UI's own token when it defines one and
 * falls back to the system canvas color otherwise — never a foreign token.
 */
export const WINDOWS_TITLEBAR_HEIGHT = 40

export const WINDOWS_TITLEBAR_CSS = `
  html {
    background-color: Canvas;
  }

  html::after {
    content: "";
    position: fixed;
    z-index: 2147483647;
    top: 0;
    left: env(titlebar-area-x, 0px);
    width: env(titlebar-area-width, 100%);
    height: env(titlebar-area-height, ${WINDOWS_TITLEBAR_HEIGHT}px);
    -webkit-app-region: drag;
    app-region: drag;
  }

  body {
    box-sizing: border-box !important;
    height: 100vh !important;
    padding-top: ${WINDOWS_TITLEBAR_HEIGHT}px !important;
    background-color: var(--dsw-alias-bg-base, Canvas) !important;
    overflow: hidden !important;
  }
`

/**
 * Paint the drag strip once the UI finished loading (Windows only).
 * @param webContents - the window's webContents.
 * @returns nothing.
 */
export async function applyWindowsTitleBarStyle(webContents) {
  await webContents.insertCSS(WINDOWS_TITLEBAR_CSS)
}

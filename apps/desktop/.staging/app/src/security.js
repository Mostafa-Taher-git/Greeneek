/**
 * Window security policy: what the sandboxed renderer may open or be granted.
 * Pure predicates, unit-tested without Electron.
 */

/**
 * Whether a URL is one the app window may load itself.
 * Loopback http(s) (the local service), file URLs (the splash screen), and
 * nothing else: every other origin opens in the system browser instead.
 * @param rawUrl - the URL asking to load.
 * @returns true when the window may navigate there in-app.
 */
export function isTrustedAppUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') return true
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
}

/**
 * Whether a permission request may be granted.
 * The local UI needs nothing beyond sanitized clipboard writes on its own
 * main frame; everything else (media, notifications, fullscreen, pointer
 * lock) stays denied so a compromised renderer gains no host capability.
 * @param permission - the permission name Electron asks about.
 * @param requestingUrl - the frame's URL, when known.
 * @param isMainFrame - whether the request comes from the main frame.
 * @returns true only for clipboard-sanitized-write on the loopback UI.
 */
export function canGrantWindowPermission(permission, requestingUrl, isMainFrame) {
  return permission === 'clipboard-sanitized-write'
    && isMainFrame === true
    && typeof requestingUrl === 'string'
    && isTrustedAppUrl(requestingUrl)
}

/**
 * Wire the policy onto a live window's webContents.
 * Window-open and cross-origin navigation escape to the system browser;
 * webviews are refused; permission handlers consult the predicate above.
 * @param webContents - the window's webContents.
 * @param shell - the Electron shell module (openExternal).
 * @returns nothing.
 */
export function secureWindow(webContents, shell) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAppUrl(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (event, url) => {
    const current = webContents.getURL()
    if (!current) return
    if (new URL(url).origin !== new URL(current).origin) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  webContents.session.setPermissionCheckHandler((webContentsOwner, permission, requestingUrl) => {
    void webContentsOwner
    return canGrantWindowPermission(permission, requestingUrl?.toString(), true)
  })
  webContents.session.setPermissionRequestHandler((webContentsOwner, permission, callback, details) => {
    void webContentsOwner
    callback(canGrantWindowPermission(
      permission,
      details?.requestingUrl,
      details?.isMainFrame ?? false,
    ))
  })
}

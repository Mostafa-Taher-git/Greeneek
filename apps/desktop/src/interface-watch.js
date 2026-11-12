/**
 * Interface readiness: does the web application actually render, and what did
 * the renderer report while it tried?
 *
 * The desktop window navigates to the local service and shows the splash
 * until the application paints. A page that loads but renders nothing leaves
 * the user with a blank window and the shell with no clue why, so the shell
 * watches for the application's own root and keeps the renderer's diagnostics.
 */

/** How long the shell waits for the application to paint before it reports. */
export const INTERFACE_READY_TIMEOUT_MS = 20_000

/** The expression the shell evaluates in the renderer to find the application. */
export const INTERFACE_READY_EXPRESSION = 'Boolean(document.querySelector(\'[class*="frame"]\'))'

/**
 * Read one Electron console event into a diagnostic line.
 * @param {unknown} event - the Electron console-message event.
 * @returns {{ level: string, message: string } | undefined} the diagnostic, or undefined when the event carries no message.
 */
export function rendererDiagnostic(event) {
  if (typeof event !== 'object' || event === null) return undefined
  const record = /** @type {{ level?: unknown, message?: unknown }} */ (event)
  if (typeof record.message !== 'string' || record.message === '') return undefined
  return {
    level: typeof record.level === 'string' ? record.level : 'info',
    message: record.message,
  }
}

/**
 * Render the collected diagnostics as the lines of a failure report.
 * @param {ReadonlyArray<{ level: string, message: string }>} diagnostics - the renderer diagnostics, oldest first.
 * @returns {string[]} the report lines.
 */
export function diagnosticReport(diagnostics) {
  return diagnostics.map(diagnostic => `[${diagnostic.level}] ${diagnostic.message}`)
}

/**
 * The script the shell evaluates to show the failure over a blank page.
 *
 * The window keeps the application's own URL: a failure page on another origin
 * would be blocked by the navigation policy, and the retry needs the service
 * URL the window already holds.
 * @param {{ reason: string, diagnostics: readonly string[] }} payload - the failure reason and the renderer diagnostics.
 * @returns {string} the script text.
 */
export function interfaceFailureScript(payload) {
  return `(() => {
    const { reason, diagnostics } = ${JSON.stringify(payload)}
    if (document.getElementById('greeneek-interface-failure')) return
    const root = document.createElement('div')
    root.id = 'greeneek-interface-failure'
    root.setAttribute('role', 'alert')
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'auto',
      display: 'flex', flexDirection: 'column', gap: '12px', padding: '32px',
      background: '#101418', color: '#e6e9ec', font: '13px/1.5 system-ui, sans-serif',
    })
    const title = document.createElement('h1')
    title.textContent = 'Greeneek could not load its interface'
    Object.assign(title.style, { margin: '0', fontSize: '18px' })
    const detail = document.createElement('p')
    detail.textContent = reason
    Object.assign(detail.style, { margin: '0' })
    const report = document.createElement('pre')
    report.textContent = diagnostics.join('\\n')
    Object.assign(report.style, {
      margin: '0', padding: '12px', borderRadius: '8px', maxHeight: '40vh',
      overflow: 'auto', background: '#1b2026', color: '#c9d1d9', whiteSpace: 'pre-wrap',
    })
    const retry = document.createElement('button')
    retry.textContent = 'Retry'
    Object.assign(retry.style, {
      alignSelf: 'flex-start', padding: '6px 14px', borderRadius: '8px',
      border: '1px solid #2b323a', background: '#1f2933', color: '#e6e9ec', cursor: 'pointer',
    })
    retry.addEventListener('click', () => { location.reload() })
    root.append(title, detail, report, retry)
    document.body.append(root)
  })()`
}

/**
 * Name the reason the interface is missing.
 *
 * The shell reads the service itself: a 404 means the web assets were never
 * built (or the build was interrupted), while a served page that never paints
 * means the application failed in the renderer.
 * @param {string} url - the service URL the window navigated to.
 * @param {(input: string) => Promise<{ ok: boolean, status: number }>} read - the HTTP reader.
 * @returns {Promise<string>} the reason, ready for the failure report.
 */
export async function describeMissingInterface(url, read = (input) => fetch(input)) {
  try {
    const response = await read(url)
    if (!response.ok) {
      return `The interface assets were not served (HTTP ${response.status}). `
        + 'Build the web app before launching the desktop application.'
    }
  } catch (error) {
    return `The local service could not be read: ${error instanceof Error ? error.message : String(error)}`
  }
  return 'The interface loaded but never rendered.'
}

/**
 * Wait until the application paints, or the timeout passes.
 * @param {{ window: { webContents: { executeJavaScript: (code: string) => Promise<unknown> } }, timeoutMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} options - the window to probe and the wait shape.
 * @returns {Promise<{ ready: boolean, elapsedMs: number }>} whether the application painted and how long the wait took.
 */
export async function waitForInterface({
  window,
  timeoutMs = INTERFACE_READY_TIMEOUT_MS,
  pollMs = 250,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) }),
}) {
  const started = Date.now()
  for (;;) {
    try {
      const ready = await window.webContents.executeJavaScript(INTERFACE_READY_EXPRESSION)
      if (ready === true) return { ready: true, elapsedMs: Date.now() - started }
    } catch {
      // A navigation in flight refuses the evaluation; the next poll tries again.
    }
    if (Date.now() - started >= timeoutMs) {
      return { ready: false, elapsedMs: Date.now() - started }
    }
    await sleep(pollMs)
  }
}

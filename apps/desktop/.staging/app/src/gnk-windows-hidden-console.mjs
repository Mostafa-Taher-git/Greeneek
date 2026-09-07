import koffi from 'koffi'

/** SW_HIDE: hide the window (and activate another window). */
const SW_HIDE = 0

/**
 * Attach a hidden console to the current (console-less) process.
 * The desktop spawns the child detached and hidden, so it has no console; on
 * Windows a console child spawned from a console-less parent with only
 * `windowsHide` still allocates a briefly-visible console of its own. Owning
 * a console that is already hidden makes children inherit it, and their
 * `CREATE_NO_WINDOW` then suppresses their windows as intended. `detached`
 * stays in place, preserving Ctrl+C process-group isolation.
 * @param options - library loader, injectable for tests (defaults to `koffi.load`).
 * @returns true when a console was attached and hidden.
 */
export function createHiddenConsole({ load = koffi.load } = {}) {
  try {
    const kernel32 = load('kernel32.dll')
    const user32 = load('user32.dll')
    const allocConsole = kernel32.func('AllocConsole', 'bool', [])
    const getConsoleWindow = kernel32.func('GetConsoleWindow', 'void *', [])
    const showWindow = user32.func('ShowWindow', 'bool', ['void *', 'int'])
    if (!allocConsole()) return false
    const window = getConsoleWindow()
    if (window) showWindow(window, SW_HIDE)
    return true
  } catch {
    // Best-effort: a failure here must never block startup.
    return false
  }
}

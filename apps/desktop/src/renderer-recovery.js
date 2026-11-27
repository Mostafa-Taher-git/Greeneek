/** Bounded renderer crash recovery policy shared by the main process and tests. */

/** Maximum automatic reloads within the recovery window. */
export const RENDERER_RELOAD_LIMIT = 2

/** Window in which automatic reloads are counted. */
export const RENDERER_RELOAD_WINDOW_MS = 60_000

/**
 * Decide the recovery action for a renderer crash and record an automatic retry.
 * @param options - crash reason, current time, and the mutable reload timestamp list.
 * @returns `'none'` for clean exits, `'reload'` for a bounded retry, or `'dialog'` after repeated crashes.
 */
export function rendererCrashAction({
  reloads,
  now = Date.now(),
  reason,
  limit = RENDERER_RELOAD_LIMIT,
  windowMs = RENDERER_RELOAD_WINDOW_MS,
}) {
  if (reason === 'clean-exit') return 'none'
  for (let i = reloads.length - 1; i >= 0; i -= 1) {
    if (now - reloads[i] > windowMs) reloads.splice(i, 1)
  }
  if (reloads.length < limit) {
    reloads.push(now)
    return 'reload'
  }
  return 'dialog'
}

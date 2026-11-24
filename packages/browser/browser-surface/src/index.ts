/**
 * Default browser-use provider. It drives no browser process: the service owns
 * the tracked navigation state and the renderer presents it in the existing
 * right-panel webview/iframe. Registering this backend makes agent tools and
 * the visible browser surface share one authority.
 * @module @greeneek/gnk-browser-surface
 */
import type { Context } from '@greeneek/cordis'
import type {
  BrowserBackend, BrowserBackendCloseSpec, BrowserBackendSpec,
} from '@greeneek/gnk-browser-use'

/** No-runtime provider: navigation is recorded by the service, not executed here. */
class SurfaceStateBackend implements BrowserBackend {
  readonly type = 'surface-state'

  /** @param spec - validated navigation (unused by this no-runtime provider). */
  open(spec: BrowserBackendSpec): Promise<void> {
    spec.signal?.throwIfAborted()
    return Promise.resolve()
  }

  /** @param spec - close request (unused by this no-runtime provider). */
  close(spec: BrowserBackendCloseSpec): Promise<void> {
    void spec
    return Promise.resolve()
  }
}

/** Required service. */
export const inject = ['browser']

/** Install the single surface-state backend. */
export function apply(ctx: Context): void {
  ctx.browser.registerBackend(new SurfaceStateBackend())
}

/** Surface-state browser-use plugin with its Cordis metadata. */
export default { name: 'browser-surface', inject, apply }

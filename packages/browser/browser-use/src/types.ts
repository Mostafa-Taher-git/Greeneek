/** Types for the browser-use capability seam. No runtime code lives here. */

import type { Agent } from '@greeneek/gnk-agent'

/** Built-in browser profiles, matching the right-panel browser surface. */
export type BrowserProfile = 'default' | 'incognito'

/** Who last drove a surface: an Agent through tools, or the user through the UI. */
export type BrowserSource = 'agent' | 'user'

/** Bounded, Host-owned view of one browser profile's tracked navigation state. */
export interface BrowserSurfaceSnapshot {
  /** Profile this snapshot describes. */
  readonly profile: BrowserProfile
  /** Current tracked URL, or undefined when no page is open. */
  readonly url: string | undefined
  /** Page title. Always 'unknown' for the sandboxed web carrier. */
  readonly title: string
  /** Whether `title` is a reported value or unknown. */
  readonly titleSource: 'reported' | 'unknown'
  /** Whether a surface is open for this profile. */
  readonly status: 'open' | 'closed'
  /** Who last changed the surface. */
  readonly source: BrowserSource
}

/** One validated navigation request. */
export interface BrowserNavigateRequest {
  /** Target profile. */
  readonly profile: BrowserProfile
  /** http(s) address to load. */
  readonly url: string
}

/** One close request. */
export interface BrowserCloseRequest {
  /** Target profile. */
  readonly profile: BrowserProfile
}

/** Spec handed to the registered backend for an open/navigate operation. */
export interface BrowserBackendSpec {
  /** Target profile. */
  readonly profile: BrowserProfile
  /** Validated http(s) address. */
  readonly url: string
  /** Exact owning Agent, or undefined for a user/UI-driven change. */
  readonly owner: Agent | undefined
  /** Cancellation of the operation. */
  readonly signal: AbortSignal | undefined
}

/** Spec handed to the registered backend for a close operation. */
export interface BrowserBackendCloseSpec {
  /** Target profile. */
  readonly profile: BrowserProfile
  /** Exact owning Agent, or undefined for a user/UI-driven change. */
  readonly owner: Agent | undefined
}

/**
 * The single replaceable browser runtime slot. The default provider drives no
 * browser process: it records the visible right-panel surface state, which the
 * renderer presents in its existing webview/iframe. A future provider may attach
 * a CDP browser; only one backend may be registered at a time.
 */
export interface BrowserBackend {
  /** Provider identity, used in errors and diagnostics. */
  readonly type: string
  /** Apply an open/navigate operation. */
  open(spec: BrowserBackendSpec): Promise<void>
  /** Apply a close operation. */
  close(spec: BrowserBackendCloseSpec): Promise<void>
}

/** Machine-readable browser-use error codes. */
export type BrowserErrorCode =
  | 'DUPLICATE_BACKEND'
  | 'NO_BACKEND'
  | 'FOREIGN_OWNER'
  | 'OWNER_NOT_LIVE'
  | 'NO_SURFACE'
  | 'SERVICE_DISPOSING'
  | 'INVALID_URL'

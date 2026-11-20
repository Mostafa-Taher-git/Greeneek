/** Types for the browser-use capability seam. No runtime code lives here. */

import type { Agent } from '@greeneek/gnk-agent'

/** Built-in browser profiles, matching the right-panel browser surface. */
export type BrowserBuiltInProfile = 'default' | 'incognito'
/** Provider-isolated profiles, e.g. `provider:chatgpt`. Only constructed by a trusted registry. */
export type BrowserProviderProfile = `provider:${string}`
/** All profiles the browser runtime can address. */
export type BrowserProfile = BrowserBuiltInProfile | BrowserProviderProfile

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

/** One bounded link extracted from a live page. */
export interface BrowserPageLink {
  /** Visible link text, trimmed and bounded. */
  readonly text: string
  /** Absolute or raw href as published by the page. */
  readonly href: string
}

/** Bounded content read from a real page. All text is untrusted page data. */
export interface BrowserPageContent {
  /** Page URL after any redirects. */
  readonly url: string
  /** Reported document title. */
  readonly title: string
  /** Extracted visible text, bounded by the configured character cap. */
  readonly text: string
  /** Bounded visible links, for navigation and link-following. */
  readonly links: readonly BrowserPageLink[]
  /** HTTP status when the navigation produced a response. */
  readonly status: number | undefined
  /** True when the text was truncated at the configured cap. */
  readonly truncated: boolean
}

/** Spec for a content read or link-activation operation. */
export interface BrowserContentSpec {
  /** Target profile. */
  readonly profile: BrowserProfile
  /** URL to navigate to, or undefined to read/act on the current page. */
  readonly url: string | undefined
  /** Exact owning Agent, or undefined for a user/UI-driven read. */
  readonly owner: Agent | undefined
  /** Cancellation of the operation. */
  readonly signal: AbortSignal | undefined
}

/** A link selector for activation: by visible text or by href substring. */
export interface BrowserLinkSelector {
  /** Match a link whose visible text contains this string. */
  readonly text?: string
  /** Match a link whose href contains this string. */
  readonly href?: string
}

/**
 * Optional content capability. A provider that implements these methods can
 * let an Agent genuinely read and navigate real pages; one that does not is
 * limited to tracked navigation state and reports CONTENT_UNSUPPORTED.
 */
export interface BrowserContentBackend extends BrowserBackend {
  /** Read bounded text, title and links from a real page. */
  read(spec: BrowserContentSpec): Promise<BrowserPageContent>
  /** Activate a visible link and return the resulting page content. */
  click(spec: BrowserContentSpec & { selector: BrowserLinkSelector }): Promise<BrowserPageContent>
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
  | 'CONTENT_UNSUPPORTED'
  | 'NAVIGATION_FAILED'
  | 'CONTENT_UNAVAILABLE'
  | 'LINK_NOT_FOUND'

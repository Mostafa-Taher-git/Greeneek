/** Types for the Browser AI connection seam. No runtime code lives here. */

import type { BrowserProviderProfile } from '@greeneek/gnk-browser-use'

/** Vendor identity for a browser AI provider. */
export type BrowserAIVendor = 'openai' | 'anthropic' | 'google'

/** A provider's declared capabilities. Manual and automation are independent. */
export interface BrowserAIProvider {
  /** Stable provider id, unique in the registry. */
  readonly id: string
  /** Vendor this provider belongs to. */
  readonly vendor: BrowserAIVendor
  /** Localized display label key (resolved by the UI). */
  readonly labelKey: string
  /** Official web interface URL opened in Greeneek's own browser surface. */
  readonly officialUrl: string
  /** Manual conversation is supported: the user signs in and uses the site. */
  readonly manual: boolean
  /**
   * Authorized automation is supported. False means Maestro/Modes are refused
   * by name, and the exact reason is reported rather than approximated.
   */
  readonly automation: boolean
  /** Exact reason when automation is not supported (terms or reliability). */
  readonly automationReason: string | undefined
  /** Where the terms/technical finding was recorded, for re-verification. */
  readonly termsSource: string
}

/** Lifecycle state of one provider's browser session. */
export type BrowserAISessionStatus =
  | 'login-required'
  | 'connected'
  | 'session-expired'
  | 'unavailable'

/** One provider session snapshot. Never contains cookies, tokens or passwords. */
export interface BrowserAISession {
  /** Provider id. */
  readonly providerId: string
  /** Isolated browser profile used for this provider. */
  readonly profile: BrowserProviderProfile
  /** Official URL for the provider. */
  readonly url: string
  /** Current session status. */
  readonly status: BrowserAISessionStatus
  /** Provider-declared capabilities. */
  readonly capabilities: Pick<BrowserAIProvider, 'manual' | 'automation' | 'automationReason'>
}

/** Machine-readable Browser AI failure codes. */
export type BrowserAIErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'DUPLICATE_PROVIDER'
  | 'MANUAL_UNAVAILABLE'
  | 'AUTOMATION_UNAVAILABLE'
  | 'SERVICE_DISPOSING'

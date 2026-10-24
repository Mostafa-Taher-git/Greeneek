/**
 * Stable failure vocabulary for the Craft bridge.
 * @module @greeneek/gnk-craft/error
 */

/** Failure codes consumers may branch on. */
export type CraftErrorCode =
  | 'CRAFT_APP_NOT_IN_PILOT'
  | 'CRAFT_MANIFEST_INVALID'
  | 'CRAFT_NO_PROVIDER'
  | 'CRAFT_PROVIDER_AMBIGUOUS'
  | 'CRAFT_ATTACH_DISABLED'
  | 'CRAFT_HEADLESS_UNSUPPORTED'
  | 'CRAFT_LIMIT_REACHED'
  | 'CRAFT_ROOT_INVALID'
  | 'CRAFT_TOKEN_REQUIRED'
  | 'CRAFT_SESSION_UNKNOWN'
  | 'CRAFT_APP_NOT_READY'
  | 'CRAFT_APP_ERROR'
  | 'CRAFT_TRANSPORT_CLOSED'
  | 'CRAFT_TRANSPORT_TIMEOUT'

/** Error carrying a stable code alongside an actionable message. */
export class CraftError extends Error {
  /** Stable failure code. */
  readonly code: CraftErrorCode

  /**
   * @param message - actionable detail.
   * @param code - stable failure code.
   * @param options - standard error options (for example a `cause`).
   */
  constructor(message: string, code: CraftErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CraftError'
    this.code = code
  }
}

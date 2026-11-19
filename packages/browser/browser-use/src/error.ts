import type { BrowserErrorCode } from './types.ts'

/** Stable browser-use failure with a machine-readable code and safe details. */
export class BrowserError extends Error {
  /** @param code - stable wire code. @param message - human-readable reason. */
  constructor(readonly code: BrowserErrorCode, message: string) {
    super(message)
    this.name = 'BrowserError'
  }
}

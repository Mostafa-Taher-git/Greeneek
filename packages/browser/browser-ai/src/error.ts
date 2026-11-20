import type { BrowserAIErrorCode } from './types.ts'

/** Stable Browser AI failure with a machine-readable code. */
export class BrowserAIError extends Error {
  /** @param code - stable wire code. @param message - human-readable reason. */
  constructor(readonly code: BrowserAIErrorCode, message: string) {
    super(message)
    this.name = 'BrowserAIError'
  }
}

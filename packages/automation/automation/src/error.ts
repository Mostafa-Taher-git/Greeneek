import type { AutomationErrorCode } from './types.ts'

/** Stable automation failure with a machine-readable code. */
export class AutomationError extends Error {
  /** @param code - stable wire code. @param message - human-readable reason. */
  constructor(readonly code: AutomationErrorCode, message: string) {
    super(message)
    this.name = 'AutomationError'
  }
}

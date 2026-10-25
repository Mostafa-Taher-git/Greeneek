/**
 * Typed failures for wave admission, control, and budget enforcement.
 *
 * @module @greeneek/gnk-subagent-wave
 */

import { HarnessError } from '@greeneek/gnk-llm'

/** Stable failure codes for the wave engine. */
export type WaveErrorCode =
  | 'INVALID_CONFIG'
  | 'NO_PROVIDER'
  | 'EMPTY_WAVE'
  | 'BUDGET_METER_UNAVAILABLE'
  | 'WAVE_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'

/** Typed failure for a wave operation. */
export class WaveError extends HarnessError {
  constructor(message: string, code: WaveErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'WaveError'
  }
}

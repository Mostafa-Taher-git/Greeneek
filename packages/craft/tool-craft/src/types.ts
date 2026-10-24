/**
 * Public vocabulary for the Craft gateway tools.
 * @module @greeneek/gnk-tool-craft/types
 */

import type { CraftRoots } from '@greeneek/gnk-craft'
import type { JsonValue } from '@greeneek/gnk-util-values'

/** Requested gateway mode; `close` releases one active app. */
export type CraftOpenMode = 'headless' | 'attach' | 'close'

/** Result of projecting one app call for the model. */
export interface CraftProjectedCall {
  /** Ordered content blocks exactly as the app reported them. */
  readonly content: readonly JsonValue[]
  /** Confined absolute artifact paths. */
  readonly artifacts: readonly string[]
  /** Model-facing text, including the artifact list. */
  readonly text: string
}

/** Registered bridge tools for one active app. */
export interface CraftAppBridge {
  /** Registered public tool names. */
  readonly names: readonly string[]
  /** Exact unregister disposers. */
  readonly disposers: readonly (() => void)[]
}

/** Model-facing summary of one gateway operation. */
export interface CraftOpenSummary {
  /** Canonical app id. */
  readonly app: string
  /** Product name. */
  readonly displayName: string
  /** Session transition. */
  readonly state: 'running' | 'closed' | 'not-open'
  /** Registered bridge tool names while running. */
  readonly tools?: readonly string[]
  /** Confined roots while running. */
  readonly roots?: CraftRoots
  /** Absolute artifact root while running. */
  readonly artifactsRoot?: string
}

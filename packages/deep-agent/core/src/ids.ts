/** Deterministic content-derived ids. Adapted from the prototype's `src/core/ids.ts`. */
import { createHash } from 'node:crypto'

/** First 32 hex characters of sha256 over the JSON of the given values. */
export function key(...values: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}

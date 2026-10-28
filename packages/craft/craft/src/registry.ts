/**
 * Provider-neutral command-registry canonicalization and drift hashing.
 * @module @greeneek/gnk-craft/registry
 */

import { createHash } from 'node:crypto'
import { CraftError } from './error.ts'

/**
 * Hash one raw command registry after recursively sorting object keys.
 * Array order remains significant because it is part of the observed payload.
 * @param value - raw JSON registry result, excluding its response envelope.
 * @returns `sha256:` followed by the lowercase digest.
 */
export function hashCommandRegistry(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value)) as string | undefined
  if (serialized === undefined) {
    throw new CraftError('the Craft command registry is not a JSON value', 'CRAFT_APP_ERROR')
  }
  return `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`
}

/** Recursively sort JSON object keys without changing array order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]))
}

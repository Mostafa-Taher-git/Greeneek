/**
 * Structural secret redaction for settings values. `role('secret')` fields are
 * removed from a value before it crosses a wire boundary; a sidecar records
 * each schema-declared secret position and whether it currently holds a value,
 * so a configuration surface can render a write-only input without ever
 * receiving the secret itself.
 * @module @greeneek/gnk-settings/redact
 */

import type z from '@greeneek/schemastery'

/**
 * Minimal structural view of a live schemastery node. The relations the
 * redactor walks (`dict`/`inner`) are named alongside the relations it does
 * not walk (`list`, `sKey`, `builder`), which are inspected only to detect a
 * secret the walker cannot reach.
 */
interface SchemaNode {
  type?: string | undefined
  meta?: { role?: unknown } | undefined
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SchemaNode> | undefined
  /** `dict`/`array` element schema (and the wrapped schema for `transform`/`lazy`). */
  inner?: SchemaNode | undefined
  /** Member schemas for `union`, `intersection`, and `tuple`. */
  list?: SchemaNode[] | undefined
  /** Key schema for `dict`. */
  sKey?: SchemaNode | undefined
  /** Schema builder for `lazy` (matching the schemastery `Function` type). */
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  builder?: Function | undefined
}

/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root to the removed field (concrete dict keys and array indexes included). */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** A value with every `role('secret')` field removed, plus the removal record. */
export interface RedactedValue {
  /** Detached copy of the input with secret fields absent. */
  value: unknown
  /**
   * Every reachable secret position: object properties always (even unset, so
   * a form knows the slot exists), dict entries and array items only where the
   * value has them.
   */
  secrets: RedactedSecret[]
}

/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Assign one entry to a rebuilt record without invoking inherited setters or
 * the `__proto__` prototype setter. JSON data may carry keys named
 * `__proto__`, `constructor`, or `toString`; plain assignment would either
 * mutate the rebuilt object's prototype or use the inherited accessor,
 * losing the entry or polluting the detached value.
 * @param target - the rebuilt record.
 * @param key - the property key.
 * @param value - the stripped value to store as an own property.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

/**
 * Whether a schema subtree declares `role('secret')` anywhere, including under
 * relations the walker does not follow. Used to fail closed: an unhandled
 * container that hides a secret must refuse rather than return the value
 * verbatim.
 * @param node - schema node to inspect.
 * @param seen - nodes already visited, so recursive schemas stay finite.
 * @returns whether a secret role occurs in the subtree.
 */
function containsSecret(node: SchemaNode | undefined, seen: Set<SchemaNode> = new Set()): boolean {
  if (node === undefined || seen.has(node)) return false
  seen.add(node)
  if (node.meta?.role === 'secret') return true
  if (node.dict !== undefined && Object.values(node.dict).some(child => containsSecret(child, seen))) return true
  if (node.inner !== undefined && containsSecret(node.inner, seen)) return true
  if (node.list !== undefined && node.list.some(child => containsSecret(child, seen))) return true
  if (node.sKey !== undefined && containsSecret(node.sKey, seen)) return true
  // A lazy node's deferred schema cannot be inspected without evaluating its
  // builder, so it cannot be proven secret-free.
  if (node.builder !== undefined) return true
  return false
}

function walk(node: SchemaNode | undefined, value: unknown, path: string[], secrets: RedactedSecret[]): unknown {
  if (node === undefined) return value
  if (node.meta?.role === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {}
      const source = isRecord(value) ? value : undefined
      const rebuilt: Record<string, unknown> = {}
      if (source !== undefined) {
        for (const [key, entry] of Object.entries(source)) {
          if (Object.hasOwn(properties, key)) continue
          setOwn(rebuilt, key, entry)
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walk(child, source?.[key], [...path, key], secrets)
        if (stripped !== undefined) setOwn(rebuilt, key, stripped)
      }
      return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt
    }
    case 'dict': {
      if (node.sKey !== undefined && containsSecret(node.sKey)) {
        throw new Error(
          `redactSecrets: cannot prove dict key schema at ${JSON.stringify(path)} is secret-free; refusing to redact.`,
        )
      }
      if (!isRecord(value)) return value
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], secrets)
        if (stripped !== undefined) setOwn(rebuilt, key, stripped)
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) return value
      return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets))
    }
    default: {
      // Fail closed: an unhandled container (union, intersection, tuple,
      // transform, lazy, ...) cannot be walked, so a secret reachable only
      // through it must refuse instead of being returned verbatim.
      if (containsSecret(node)) {
        throw new Error(
          `redactSecrets: cannot prove schema type ${JSON.stringify(node.type)} at ${JSON.stringify(path)} is secret-free; refusing to redact.`,
        )
      }
      return value
    }
  }
}

/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker follows `object`, `dict`, and `array` containers; a secret must be
 * declared directly on a field reachable through those containers. A secret
 * reachable only through an unhandled container (union, intersection, tuple,
 * transform, lazy, or dict key schema) cannot be walked, so the walker fails
 * closed and throws instead of returning the value verbatim. The input is
 * never mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value and the ordered secret positions.
 * @throws {Error} when a secret is reachable only through an unhandled schema form.
 */
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const secrets: RedactedSecret[] = []
  const stripped = walk(schema, value, [], secrets)
  return { value: stripped, secrets }
}

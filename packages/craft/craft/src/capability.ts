/**
 * Runtime capability-matrix generation and drift caching.
 *
 * The matrix is a projection of one live command-registry response (the MCP
 * `tools/list` result or the `serve` `engine.commands` result), never ported
 * documentation. `CapabilityCache` records the first observed hash per app as
 * the drift baseline and reports a later hash that disagrees; first-use never
 * becomes a reviewed baseline — only a manifest `trustedRegistryHash` sets
 * `registryReviewed`.
 * @module @greeneek/gnk-craft/capability
 */

import { CraftError } from './error.ts'
import { hashCommandRegistry } from './registry.ts'
import type { CraftCapabilityMatrix, CraftToolDescriptor } from './types.ts'

/**
 * Project one live command-registry response into tool descriptors.
 * @param app - canonical app id used in diagnostics and the matrix.
 * @param raw - raw JSON-RPC result value, excluding its response envelope.
 * @returns the capability matrix with drift hash.
 */
export function buildCapabilityMatrix(app: string, raw: unknown): CraftCapabilityMatrix {
  const entries = registryEntries(raw)
  const tools = entries.map((entry, index) => projectRegistryEntry(entry, index, app))
  return {
    app,
    tools,
    hash: hashCommandRegistry(raw),
    method: matrixMethod(raw),
  }
}

/**
 * Project one observed registry into the drift-compare hash.
 * @param raw - raw JSON-RPC result value.
 * @returns `sha256:` digest.
 */
export function hashCapabilityMatrix(raw: unknown): string {
  return hashCommandRegistry(raw)
}

/** Process-local cache of first-observed capability hashes per app. */
export class CapabilityCache {
  private readonly baseline = new Map<string, string>()
  private readonly observed = new Map<string, string>()

  /**
   * Record one observed hash. The first hash becomes the drift baseline.
   * @param app - canonical app id.
   * @param hash - drift hash from `buildCapabilityMatrix`.
   * @returns whether this hash disagrees with the stored baseline.
   */
  remember(app: string, hash: string): boolean {
    this.observed.set(app, hash)
    const first = this.baseline.get(app)
    if (first === undefined) {
      this.baseline.set(app, hash)
      return false
    }
    return first !== hash
  }

  /**
   * Last observed hash for one app.
   * @param app - canonical app id.
   * @returns the hash, or undefined when never observed.
   */
  lastObserved(app: string): string | undefined {
    return this.observed.get(app)
  }

  /**
   * First-observed baseline hash for one app.
   * @param app - canonical app id.
   * @returns the baseline, or undefined when never observed.
   */
  baselineHash(app: string): string | undefined {
    return this.baseline.get(app)
  }

  /**
   * Whether one fresh hash drifts from the stored baseline.
   * @param app - canonical app id.
   * @param hash - fresh observation.
   * @returns `true` only when a baseline exists and disagrees.
   */
  drifted(app: string, hash: string): boolean {
    const first = this.baseline.get(app)
    return first !== undefined && first !== hash
  }

  /**
   * Drifted app ids whose last observation disagrees with the baseline.
   * @returns canonical app ids, sorted.
   */
  driftedApps(): readonly string[] {
    return [...this.baseline.keys()].filter((id) => {
      const first = this.baseline.get(id) as string
      return this.observed.get(id) !== first
    }).sort()
  }
}

/** Extract the raw command entries from one registry response. */
function registryEntries(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object' || raw === null) {
    throw new CraftError('the Craft app command registry is not a JSON value', 'CRAFT_APP_ERROR')
  }
  const record = raw as Record<string, unknown>
  const entries = record.tools ?? record.commands
  if (!Array.isArray(entries)) {
    throw new CraftError('the Craft app command registry carries no tools or commands array', 'CRAFT_APP_ERROR')
  }
  return entries
}

/** Project one registry entry into a tool descriptor. */
function projectRegistryEntry(value: unknown, index: number, app: string): CraftToolDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CraftError(`the Craft app "${app}" advertised an invalid command at index ${String(index)}`, 'CRAFT_APP_ERROR')
  }
  const entry = value as Record<string, unknown>
  const name = typeof entry.name === 'string' && entry.name.trim() !== ''
    ? entry.name
    : typeof entry.id === 'string' && entry.id.trim() !== ''
      ? entry.id
      : undefined
  if (name === undefined) {
    throw new CraftError(`the Craft app "${app}" advertised an invalid command at index ${String(index)}`, 'CRAFT_APP_ERROR')
  }
  const description = typeof entry.description === 'string' ? entry.description : ''
  const schema = entry.inputSchema ?? entry.input ?? entry.schema
  const inputSchema = typeof schema === 'object' && schema !== null && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : { type: 'object' }
  return { name, description, inputSchema }
}

/** How one registry response was observed. */
function matrixMethod(raw: unknown): CraftCapabilityMatrix['method'] {
  if (Array.isArray(raw)) return 'command-list'
  const record = raw as Record<string, unknown>
  return Array.isArray(record.tools) ? 'tools-list' : 'engine-commands'
}

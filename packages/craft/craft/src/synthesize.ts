/**
 * Synthesis of an ephemeral manifest for an auto-detected app.
 *
 * An auto-detected app has no hand-written manifest, so the gateway builds one
 * from observed discovery facts only: the launcher id, display name, install
 * directory, and version. Every security-sensitive field keeps the gateway
 * default (attach disabled, confined roots, child-process cancellation, MCP
 * headless launch without a control-token file because no loopback port
 * exists to authenticate). The synthesized `verified` claim stays false and
 * `trustedRegistryHash` stays null, so first use never becomes a recipe.
 * @module @greeneek/gnk-craft/synthesize
 */

import { parseManifest } from './manifest.ts'
import type { CraftAppManifest, CraftDiscoveredApp, CraftPlatform } from './types.ts'

/** Platforms the auto-detect gateway publishes for synthesized manifests. */
export const AUTODETECT_PLATFORMS: readonly CraftPlatform[] = ['win32', 'linux']

/**
 * Build an ephemeral manifest for one discovered app.
 * @param discovered - host inventory entry.
 * @param tools - observed tool names; the observed catalog becomes the filter.
 * @returns a validated ephemeral manifest.
 */
export function synthesizeManifest(
  discovered: CraftDiscoveredApp,
  tools: readonly { readonly name: string }[],
): CraftAppManifest {
  const id = discovered.id
  const displayName = discovered.displayName !== '' ? discovered.displayName : titleCase(id)
  const cliStem = discovered.cliStem ?? id
  const toolFilter = tools.length > 0 ? [...new Set(tools.map(tool => tool.name))] : ['command_list']
  const version = discovered.version !== undefined && /^\d+\.\d+\.\d+$/.test(discovered.version.trim())
    ? discovered.version.trim()
    : '0.0.0'
  return parseManifest({
    schemaVersion: 1,
    id,
    displayName,
    aliases: [],
    cliStem,
    platforms: [...AUTODETECT_PLATFORMS],
    headlessSupported: true,
    transport: 'mcp',
    minVersion: version,
    verified: false,
    attach: {
      supported: false,
      enabled: false,
      reason: 'Auto-detected apps never publish attach mode: no authenticated channel has been observed.',
    },
    launch: {
      headless: '{cli} mcp --automation-read-root {readRoot} --automation-write-root {writeRoot}',
      connected: `${cliStem} --control {jobRoot}`,
    },
    roots: { read: 'workspace', write: 'job-out' },
    cancellation: 'child-process-kill',
    riskyCommandClasses: ['overwrite', 'save-over', 'print'],
    sources: [{
      label: `Auto-detected from ${discovered.source}; facts are launcher-observed only`,
      url: `urn:greeneek:auto-detected:${id}`,
      date: '2026-11-09',
      verified: false,
    }],
    recipe: {
      name: `craft-${id}`,
      description: `Run ${displayName} headless commands and collect artifacts from the job out/ directory.`,
      file: 'recipes/discovered.md',
    },
    headless: {
      listMethod: 'command_list',
      registryMethod: null,
      trustedRegistryHash: null,
      toolFilter,
      artifactTools: [],
      artifactPatterns: [],
      controlToken: 'unused',
    },
  })
}

/**
 * Build the provisional manifest used to probe a discovered app before its
 * tool catalog is known. The filter holds one probe name; the effective
 * session manifest replaces it with the observed names.
 * @param discovered - host inventory entry.
 * @returns a validated provisional manifest.
 */
export function provisionalManifest(discovered: CraftDiscoveredApp): CraftAppManifest {
  return synthesizeManifest(discovered, [{ name: 'command_list' }])
}

/** Capitalize the first letter of one id for display when no name was reported. */
function titleCase(id: string): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

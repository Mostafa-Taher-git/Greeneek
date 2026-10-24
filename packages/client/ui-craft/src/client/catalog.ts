/**
 * Static pilot catalog for the browser half.
 *
 * The browser cannot import the Host's manifest loader, so this file mirrors
 * the two pilot manifests (`packages/craft/craft/manifests/*.json`): ids,
 * display names, artifact tool names, and the launcher/download links the
 * settings section offers. A test compares the mirror against the manifests so
 * the two cannot drift silently.
 *
 * The links are vendor placeholders pending the real-app Windows E2E; the
 * manifests' `sources[].verified` stays false for the same reason.
 */
import type { CraftAppView, CraftSettingsSource } from './contract.ts'

/** One pilot app's browser-side facts. */
export interface PilotApp {
  /** Manifest id (also the bridge tool namespace segment). */
  readonly id: string
  /** Vendor-facing app name. */
  readonly displayName: string
  /** Manifest aliases accepted by the Host gateway. */
  readonly aliases: readonly string[]
  /** Raw headless tool names whose results carry artifact paths. */
  readonly artifactTools: readonly string[]
  /** Deep link that opens the app's connected desktop window. */
  readonly launcherUrl: string
  /** Vendor download page. */
  readonly downloadUrl: string
}

/** The two apps the v0.3.4 pilot ships, in manifest order. */
export const PILOT_APPS: readonly PilotApp[] = [
  {
    id: 'photocraft',
    displayName: 'PhotoCraft',
    aliases: [],
    artifactTools: ['render_preview', 'screenshot'],
    launcherUrl: 'https://craft.example/open/photocraft',
    downloadUrl: 'https://craft.example/download/photocraft',
  },
  {
    id: 'pdfcraft',
    displayName: 'PdfCraft',
    aliases: ['printcraft'],
    artifactTools: ['render_preview'],
    launcherUrl: 'https://craft.example/open/pdfcraft',
    downloadUrl: 'https://craft.example/download/pdfcraft',
  },
]

/**
 * Bridge tool names (`mcp__<app>__<raw>`) whose results carry artifacts.
 * These are the keyed toolview registrations; a wildcard would claim every
 * bridge tool, including ones with no artifact section.
 */
export const ARTIFACT_TOOL_KEYS: readonly string[] = PILOT_APPS.flatMap(app =>
  app.artifactTools.map(tool => `mcp__${app.id}__${tool}`))

/**
 * Resolve the pilot app that owns one bridge tool name.
 * @param toolName - wire tool name (`mcp__<app>__<raw>`).
 * @returns the owning pilot app, or undefined for an unrelated tool.
 */
export function artifactTarget(toolName: string): PilotApp | undefined {
  return PILOT_APPS.find(app =>
    app.artifactTools.some(tool => `mcp__${app.id}__${tool}` === toolName))
}

/**
 * Build the pilot rows in their no-bridge state.
 * @returns one `unavailable` row per pilot app.
 */
export function fallbackRows(): readonly CraftAppView[] {
  return PILOT_APPS.map(app => ({
    id: app.id,
    displayName: app.displayName,
    state: 'unavailable',
    launcherUrl: app.launcherUrl,
    downloadUrl: app.downloadUrl,
  }))
}

/**
 * Build the no-bridge source: every read answers the static pilot rows and
 * never claims an installation state. Actions return the same row, so a
 * section that somehow enables them still cannot fabricate a transition.
 * @returns a source over {@link fallbackRows}.
 */
export function fallbackSource(): CraftSettingsSource {
  const rows = fallbackRows()
  const find = (id: string): CraftAppView => {
    const row = rows.find(entry => entry.id === id)
    if (row === undefined) throw new Error(`ui-craft: "${id}" is not a pilot app`)
    return row
  }
  return {
    available: () => Promise.resolve(rows),
    // oxlint-disable-next-line typescript/require-await -- async keeps the not-a-pilot-app guard a rejection, not a synchronous throw
    check: async (id: string) => find(id),
    // oxlint-disable-next-line typescript/require-await -- async keeps the not-a-pilot-app guard a rejection, not a synchronous throw
    launchConnected: async (id: string) => find(id),
  }
}

/**
 * Craft client contract — the measured app states the settings section renders
 * and the injected source seam that supplies them.
 *
 * The bridge itself lives on the Host (`@greeneek/gnk-craft`); the browser
 * half cannot read it directly. A future API Remote package implements
 * {@link CraftSettingsSource} over the wire. Until then the section falls back
 * to the static pilot catalog, whose rows report the localized `unavailable`
 * state instead of inventing an installation status.
 */

/**
 * One app's measured state, mirroring the host service's status vocabulary.
 * `unavailable` is client-only: it means this browser session has no bridge
 * source, not that the app is absent.
 */
export type CraftUiState =
  | 'not-installed'
  | 'app-installed-cli-missing'
  | 'ready'
  | 'running'
  | 'unavailable'

/** One pilot app as the settings section presents it. */
export interface CraftAppView {
  /** Stable pilot app id (also the manifest id). */
  readonly id: string
  /** Vendor-facing app name. */
  readonly displayName: string
  /** Measured installation or session state. */
  readonly state: CraftUiState
  /** Host-provided machine detail (version floor, discovery miss, transport error). */
  readonly detail?: string
  /** Deep link that opens the app's connected desktop window. */
  readonly launcherUrl: string
  /** Vendor download page for the app. */
  readonly downloadUrl: string
}

/**
 * The section's data source. Implementations own transport, caching, and
 * failure; the section only maps results onto rows and offers a retry.
 */
export interface CraftSettingsSource {
  /** Read every pilot app's current state (rejects when the read fails). */
  available: () => Promise<readonly CraftAppView[]>
  /** Re-run installation discovery for one app. */
  check: (id: string) => Promise<CraftAppView>
  /** Open one app's connected desktop window against the current workspace. */
  launchConnected: (id: string) => Promise<CraftAppView>
}

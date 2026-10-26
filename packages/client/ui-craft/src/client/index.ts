/**
 * Craft suite plugin, browser half: the Craft settings section (one row per
 * pilot app with its measured state and the action that fits it) and the
 * keyed artifact toolviews for the bridge tools that write files.
 *
 * The browser cannot reach the Host's craft service, so the section reads
 * through an injected {@link CraftSettingsSource}. The shipped composition
 * passes none, and the plugin falls back to the static pilot catalog whose
 * rows report `unavailable` — the desktop-only bridge is honest about being
 * absent instead of guessing an installation state. A desktop build injects a
 * wire-backed source through the plugin's second argument.
 */
import type { Context as ClientContext } from '@greeneek/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@greeneek/gnk-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@greeneek/gnk-client-ui-renderer/client'
// Type-only: pulls the settings.section SlotMap merge (this section's seat).
import type {} from '@greeneek/gnk-client-ui-settings/client'
// Type-only: pulls the tool.call.toolview SlotMap merge (the artifact cards).
import type {} from '@greeneek/gnk-client-ui-tool/client'
import { CraftArtifactRow } from './artifact/CraftArtifactRow.tsx'
import { ARTIFACT_TOOL_KEYS, fallbackSource } from './catalog.ts'
import type { CraftSettingsSource } from './contract.ts'
import { ar, en, NS, zh, type CraftKey } from './locales.ts'
import { CraftSection } from './settings/CraftSection.tsx'
import type { CraftSectionInjected } from './settings/CraftSection.tsx'

export type { CraftAppView, CraftSettingsSource, CraftUiState } from './contract.ts'
export { ARTIFACT_TOOL_KEYS, artifactTarget, fallbackRows, fallbackSource, PILOT_APPS } from './catalog.ts'
export type { PilotApp } from './catalog.ts'
export { artifactModel, basename, parseArtifactPaths } from './artifact/model.ts'
export type { CraftArtifactModel, CraftArtifactState } from './artifact/model.ts'
export { CraftArtifactRow } from './artifact/CraftArtifactRow.tsx'
export { CraftSection } from './settings/CraftSection.tsx'
export type { CraftSectionInjected, CraftSectionProps } from './settings/CraftSection.tsx'
export type { CraftKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Craft settings section's and artifact card's copy. */
    craft: CraftKey
  }
}

/** Required services: the dictionary registry and the slot ledger. */
export const inject = ['locale', 'slots']

/** Mount-time options. */
export interface CraftPluginOptions {
  /**
   * Host-backed app source. Omit in a composition with no desktop bridge: the
   * static pilot fallback reports every app as `unavailable`.
   */
  readonly source?: CraftSettingsSource
}

/**
 * Client plugin body: register the dictionaries, the Craft settings section,
 * and the artifact toolviews.
 * @param ctx - client root context.
 * @param options - optional host-backed app source.
 */
export function apply(ctx: ClientContext, options: CraftPluginOptions = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'ui-craft: dictionaries')
  const source = options.source ?? fallbackSource()
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'craft-suite',
    order: 40,
    label: () => t('section.nav'),
    locale: NS,
    inject: (): CraftSectionInjected => ({ source }),
  }, CraftSection))
  ctx.slots.inject('tool.call.toolview', () => ARTIFACT_TOOL_KEYS.map(key => ctx.slots.register(
    { name: 'tool.call.toolview', key, locale: NS },
    CraftArtifactRow,
  )))
}

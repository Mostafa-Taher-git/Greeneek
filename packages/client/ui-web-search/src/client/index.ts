/**
 * Browser-side search-engine preference. Binds the `web` settings section
 * (the engine pin) and the `web-search-greeneek` section (the custom
 * endpoint facts), mirrors both into the row store, and registers the
 * feature-owned search-engine row into the General section's item slot.
 */
import type { Context as ClientContext } from '@greeneek/cordis'
import type { BoundActions } from '@greeneek/gnk-client-ui-slots'
// Type-only: the ctx.settingsScope Context merge and the settings slot types.
// Cross-plugin collaboration goes through the service, never a value import
// (client bundle purity gate).
import type { SettingsScope } from '@greeneek/gnk-client-ui-settings/client'
import type {} from '@greeneek/gnk-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import {
  CUSTOM_BASE_URL_FIELD, CUSTOM_MODEL_FIELD, CUSTOM_SEARCH_SETTINGS_NAMESPACE,
  SEARCH_PROVIDER_FIELD, WEB_SETTINGS_NAMESPACE, isOfferedEngine,
  type CustomSearchSettings, type WebEngineSettings,
} from '../search-engine-settings.ts'
import { en, zh } from '../locales.ts'
import type { SettingsWebSearchKey } from '../locales.ts'
import type { SearchEngineRowInjected } from './SearchEngineRow.tsx'
import { SearchEngineRow } from './SearchEngineRow.tsx'
import { createSearchEngineRowStore } from './search-engine-store.ts'

export type { SearchEngineRowComponentProps, SearchEngineRowInjected } from './SearchEngineRow.tsx'
export type { SearchEngineRowState } from './search-engine-store.ts'
export type { CustomSearchSettings, SearchEngineId, WebEngineSettings } from '../search-engine-settings.ts'
export type { SettingsWebSearchKey } from '../locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This feature's own settings-row copy (the search-engine row). */
    'settings.web-search': SettingsWebSearchKey
  }
}

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.web-search'

/** Required services: slot registration, locale dictionaries, and the settings transport. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Client plugin body: mirror the engine and custom-endpoint scopes into the
 * row store and register the feature-owned row into the General section.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const engineScope: SettingsScope<WebEngineSettings> =
    ctx.settingsScope.bind<WebEngineSettings>({ namespace: WEB_SETTINGS_NAMESPACE })
  const customScope: SettingsScope<CustomSearchSettings> =
    ctx.settingsScope.bind<CustomSearchSettings>({ namespace: CUSTOM_SEARCH_SETTINGS_NAMESPACE })
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-web-search: dictionaries')

  const store = createSearchEngineRowStore()
  let bound: BoundActions<typeof store> | undefined
  let revision = 0
  const sync = (): void => {
    const engine = engineScope.getSnapshot().value?.searchProvider ?? ''
    const custom = customScope.getSnapshot().value
    revision += 1
    bound?.sync(engine, custom?.baseURL ?? '', custom?.model ?? '', revision)
  }
  ctx.effect(() => engineScope.subscribe(sync), 'ui-web-search: engine scope adoption')
  ctx.effect(() => customScope.subscribe(sync), 'ui-web-search: custom scope adoption')
  // Scopes may already carry a saved choice at activation; state it once
  // rather than waiting for the first change.
  sync()

  const setEngine = (id: string): void => {
    if (!isOfferedEngine(id)) throw new Error(`search engine "${id}" is not offered`)
    if (id === '') {
      void engineScope.unset(SEARCH_PROVIDER_FIELD)
      return
    }
    void engineScope.set(SEARCH_PROVIDER_FIELD, id)
  }
  const setCustom = (baseURL: string, model: string): void => {
    if (baseURL === '') {
      void customScope.unset(CUSTOM_BASE_URL_FIELD)
    } else {
      void customScope.set(CUSTOM_BASE_URL_FIELD, baseURL)
    }
    if (model === '') {
      void customScope.unset(CUSTOM_MODEL_FIELD)
    } else {
      void customScope.set(CUSTOM_MODEL_FIELD, model)
    }
  }
  const injected = (actions: BoundActions<typeof store>): SearchEngineRowInjected => {
    bound = actions
    // Re-sync from the getters so no change is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync()
    return { setEngine, setCustom }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'search-engine',
    order: 1,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, SearchEngineRow))
}

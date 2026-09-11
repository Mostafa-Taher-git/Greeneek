/** Search-engine preference vocabulary shared by the row and its tests. */

import z from '@greeneek/schemastery'

/** Settings namespace owned by the web service: carries the engine choice. */
export const WEB_SETTINGS_NAMESPACE = 'web'

/** Field carrying the pinned search provider id; absence means auto-select. */
export const SEARCH_PROVIDER_FIELD = 'searchProvider'

/** Settings namespace owned by the Greeneek search provider: custom endpoint facts. */
export const CUSTOM_SEARCH_SETTINGS_NAMESPACE = 'web-search-greeneek'

/** Field carrying the custom endpoint base. */
export const CUSTOM_BASE_URL_FIELD = 'baseURL'

/** Field carrying the custom endpoint model. */
export const CUSTOM_MODEL_FIELD = 'model'

/** Empty engine id: no pin, the service auto-selects the only usable provider. */
export const ENGINE_AUTO = ''

/** Provider id of the DuckDuckGo search backend (keyless). */
export const ENGINE_DUCKDUCKGO = 'duckduckgo'

/** Provider id of the Google search backend. */
export const ENGINE_GOOGLE = 'google'

/** Provider id of the Exa search backend. */
export const ENGINE_EXA = 'exa'

/** Provider id of the Perplexity search backend. */
export const ENGINE_PERPLEXITY = 'perplexity'

/**
 * Provider id of the Greeneek search backend, offered in the row as Custom:
 * it accepts any Anthropic-compatible Messages endpoint, so it is the
 * vehicle for a user-supplied search engine.
 */
export const ENGINE_CUSTOM = 'greeneek-official'

/** Every engine id the row offers, in display order. */
export const ENGINE_IDS = [
  ENGINE_AUTO,
  ENGINE_DUCKDUCKGO,
  ENGINE_GOOGLE,
  ENGINE_EXA,
  ENGINE_PERPLEXITY,
  ENGINE_CUSTOM,
] as const

/** Engine id the row offers. */
export type SearchEngineId = typeof ENGINE_IDS[number]

/** True for an engine id the row offers (anything else fails loud on write). */
export function isOfferedEngine(id: string): id is SearchEngineId {
  return (ENGINE_IDS as readonly string[]).includes(id)
}

/** Durable engine-choice section shared by the Host schema and the browser scope. */
export interface WebEngineSettings {
  /** Pinned search provider id; absence means auto-select. */
  searchProvider?: string
}

/** Durable engine-choice schema; also the wire envelope the browser scope validates against. */
export const WebEngineSettingsSchema: z<WebEngineSettings> = z.object({
  [SEARCH_PROVIDER_FIELD]: z.string().required(false),
})

/** Durable custom-endpoint section shared by the Host schema and the browser scope. */
export interface CustomSearchSettings {
  /** Custom endpoint base; absence falls back to env/defaults. */
  baseURL?: string
  /** Custom endpoint model; absence falls back to the provider default. */
  model?: string
}

/** Durable custom-endpoint schema; also the wire envelope the browser scope validates against. */
export const CustomSearchSettingsSchema: z<CustomSearchSettings> = z.object({
  [CUSTOM_BASE_URL_FIELD]: z.string().required(false),
  [CUSTOM_MODEL_FIELD]: z.string().required(false),
})

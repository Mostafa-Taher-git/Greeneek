/**
 * Google-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @greeneek/gnk-web-search-google
 */

import type { Context } from '@greeneek/cordis'
import { launchEnvironmentOf } from '@greeneek/gnk-launch-environment'
import z from '@greeneek/schemastery'
import type {} from '@greeneek/gnk-web'
import {
  GoogleSearchProvider,
  GOOGLE_DEFAULT_BASE_URL,
} from './provider.ts'

export {
  GOOGLE_DEFAULT_BASE_URL,
  GOOGLE_MAX_NUM,
  GOOGLE_PROVIDER_ID,
  GoogleSearchProvider,
} from './provider.ts'
export type { GoogleSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-google'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Google API key. Falls back to `$GOOGLE_SEARCH_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Programmable Search engine id (cx). Falls back to `$GOOGLE_SEARCH_ENGINE_ID`. Empty → provider unavailable. */
  searchEngineId?: string
  /** Endpoint base; `/customsearch/v1` is appended. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  searchEngineId: z.string(),
  baseURL: z.string(),
  numResults: z.number().step(1).min(1),
})

/** Register the Google search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new GoogleSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('GOOGLE_SEARCH_API_KEY')?.value ?? '',
    searchEngineId: config.searchEngineId ?? launchEnvironmentOf(ctx).get('GOOGLE_SEARCH_ENGINE_ID')?.value ?? '',
    baseURL: config.baseURL ?? GOOGLE_DEFAULT_BASE_URL,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}

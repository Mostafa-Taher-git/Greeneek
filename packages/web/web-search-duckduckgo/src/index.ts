/**
 * DuckDuckGo-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service. Keyless: the Instant Answer API needs
 * no key, so the provider is usable out of the box.
 *
 * @module @greeneek/gnk-web-search-duckduckgo
 */

import type { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type {} from '@greeneek/gnk-web'
import {
  DuckDuckGoSearchProvider,
  DUCKDUCKGO_DEFAULT_BASE_URL,
} from './provider.ts'

export {
  DUCKDUCKGO_DEFAULT_BASE_URL,
  DUCKDUCKGO_PROVIDER_ID,
  DuckDuckGoSearchProvider,
} from './provider.ts'
export type { DuckDuckGoSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-duckduckgo'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills constant defaults). */
export interface Config {
  /** Endpoint base; `/` is queried. Defaults to the public API. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
})

/** Register the DuckDuckGo search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    baseURL: config.baseURL ?? DUCKDUCKGO_DEFAULT_BASE_URL,
  }))
}

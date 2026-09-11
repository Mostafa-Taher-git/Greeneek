/**
 * Register a Greeneek-backed provider in `ctx.web`. It calls the Anthropic-compatible Messages API
 * with native `web_search_20250305`. The provider reuses `GREENEEK_API_KEY` but not
 * `GREENEEK_BASE_URL`, because search and chat-completions use different bases.
 * @module @greeneek/gnk-web-search-greeneek
 */

import type { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type {} from '@greeneek/gnk-agent'
import { credentialRef } from '@greeneek/gnk-credentials'
import { assertEgressAllowed } from '@greeneek/gnk-egress'
import type {} from '@greeneek/gnk-settings'
import { launchEnvironmentOf } from '@greeneek/gnk-launch-environment'
import type {} from '@greeneek/gnk-session'
import type {} from '@greeneek/gnk-web'
import {
  GreeneekSearchProvider,
  GREENEEK_DEFAULT_API_VERSION,
  GREENEEK_DEFAULT_BASE_URL,
  GREENEEK_DEFAULT_MAX_TOKENS,
  GREENEEK_DEFAULT_MAX_USES,
  GREENEEK_DEFAULT_MODEL,
} from './provider.ts'
import type { GreeneekSearchProviderOptions } from './provider.ts'

export {
  GreeneekSearchProvider,
  GREENEEK_DEFAULT_API_VERSION,
  GREENEEK_DEFAULT_BASE_URL,
  GREENEEK_DEFAULT_MAX_TOKENS,
  GREENEEK_DEFAULT_MAX_USES,
  GREENEEK_DEFAULT_MODEL,
  GREENEEK_PROVIDER_ID,
} from './provider.ts'
export type { GreeneekSearchLlmRequest, GreeneekSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-greeneek'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'GREENEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Greeneek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `GREENEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL?: string
  /** Anthropic-format model name. Defaults to `greeneek-v4-flash`. */
  model?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion?: string
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(GREENEEK_DEFAULT_MODEL),
  apiVersion: z.string().default(GREENEEK_DEFAULT_API_VERSION),
  maxTokens: z.number().step(1).min(1).default(GREENEEK_DEFAULT_MAX_TOKENS),
  maxUses: z.number().step(1).min(1).default(GREENEEK_DEFAULT_MAX_USES),
})

/**
 * Environment variable naming this provider's endpoint. Deliberately distinct
 * from `$GREENEEK_BASE_URL`, which belongs to the chat-completions adapter:
 * search speaks the Anthropic-compatible Messages API, so one variable cannot
 * serve both.
 */
const SEARCH_BASE_URL_ENV = 'GREENEEK_SEARCH_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_GREENEEK_SETTINGS_NAMESPACE = 'web-search-greeneek'

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): GreeneekSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  // The egress guard validates the resolved endpoint (absolute URL, plus the
  // strict-mode allow-list when enabled); no provider is blocked by default.
  const baseURL = config.baseURL
    ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
    ?? GREENEEK_DEFAULT_BASE_URL
  assertEgressAllowed(baseURL)
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL,
    model: config.model ?? GREENEEK_DEFAULT_MODEL,
    apiVersion: config.apiVersion ?? GREENEEK_DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? GREENEEK_DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? GREENEEK_DEFAULT_MAX_USES,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/greeneek-search-llm-request',
        request,
      )
    },
  }
}

/** Register the Greeneek search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_GREENEEK_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // The registration carries no resolved value: the provider projects the
      // section per search, so a committed change needs no re-registration.
      onChange: () => {},
    })
  })
  ctx.web.registerSearchProvider(new GreeneekSearchProvider(() => resolveOptions(ctx, current())))
}

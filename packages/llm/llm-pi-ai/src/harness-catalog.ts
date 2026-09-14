/**
 * Catalog providers the harness curates itself, beside the ones the installed
 * pi-ai catalog ships. A curated provider is a first-class catalog route: the
 * Models page offers it like any shipped provider, its endpoint and wire
 * protocol are fixed here, and its model list is a curated snapshot a
 * deployment can narrow or override through `settings.yaml`.
 *
 * Auth reuses pi-ai's own `envApiKeyAuth` — a stored credential wins,
 * otherwise the declared environment variable resolves, and a login prompts
 * for the key — rather than a harness-owned copy of the same behavior.
 *
 * @module gnk-llm-pi-ai/harness-catalog
 */

import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import type { Api, Model, ModelCost, Provider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

/**
 * Pricing for a curated model. The harness never reads pi-ai's cost metadata —
 * `replay.ts` zeroes it and no consumer reports spend — so this is the absence
 * of a fact, not a configurable rate. (Kept in step with `catalog.ts`'s
 * `NO_COST`; both describe the same harness-wide fact.)
 */
const NO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** The Kilo Gateway endpoint every curated model requests. */
export const KILO_BASE_URL = 'https://api.kilo.ai/api/gateway'

/** One curated model's facts: everything a pi-ai `Model` needs that varies. */
interface CuratedModel {
  /** The gateway model id, addressed as `provider/model`. */
  id: string
  /** Display name for pickers and status labels. */
  name: string
  /** Total context the model accepts. */
  contextWindow: number
  /** Output-token ceiling per request. */
  maxTokens: number
  /** Whether the model accepts images beside text. */
  image: boolean
}

/**
 * The curated Kilo Gateway models. Capacities and modalities were read from
 * the gateway's own `GET /models` listing when this list was written; the
 * gateway serves hundreds of models that churn, so this ships only the stable
 * auto tiers and the documented popular set. A deployment corrects or extends
 * it the same way as any route: the Models page's model editor, or a
 * `models` list in `settings.yaml`.
 */
const KILO_MODELS: readonly CuratedModel[] = [
  { id: 'kilo-auto/frontier', name: 'Auto Frontier', contextWindow: 1_000_000, maxTokens: 128_000, image: true },
  { id: 'kilo-auto/balanced', name: 'Auto Balanced', contextWindow: 1_000_000, maxTokens: 65_536, image: true },
  { id: 'kilo-auto/efficient', name: 'Auto Efficient', contextWindow: 1_000_000, maxTokens: 65_536, image: true },
  { id: 'kilo-auto/small', name: 'Auto Small', contextWindow: 262_144, maxTokens: 32_768, image: true },
  { id: 'kilo-auto/free', name: 'Auto Free', contextWindow: 256_000, maxTokens: 10_000, image: false },
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', contextWindow: 1_000_000, maxTokens: 128_000, image: true },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', contextWindow: 1_000_000, maxTokens: 128_000, image: true },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', contextWindow: 200_000, maxTokens: 64_000, image: true },
  { id: 'openai/gpt-5.4', name: 'GPT-5.4', contextWindow: 1_050_000, maxTokens: 128_000, image: true },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400_000, maxTokens: 128_000, image: true },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', contextWindow: 1_048_576, maxTokens: 65_536, image: true },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_048_576, maxTokens: 65_535, image: true },
  { id: 'x-ai/grok-4.6', name: 'Grok 4.6', contextWindow: 500_000, maxTokens: 450_000, image: true },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', contextWindow: 163_840, maxTokens: 65_536, image: false },
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262_144, maxTokens: 235_929, image: true },
  { id: 'minimax/minimax-m2.7', name: 'MiniMax M2.7', contextWindow: 204_800, maxTokens: 131_072, image: false },
]

/**
 * The curated catalog providers by id. Every entry owns the API
 * implementations its models request, which is why a curated route reuses the
 * provider instead of being rebuilt from parts.
 * @returns the curated providers in curation order.
 */
export function harnessCatalogProviders(): readonly Provider[] {
  return [
    createProvider({
      id: 'kilo',
      name: 'Kilo Gateway',
      baseUrl: KILO_BASE_URL,
      auth: { apiKey: envApiKeyAuth('Kilo API key', ['KILO_API_KEY']) },
      api: { 'openai-completions': openAICompletionsApi() },
      models: KILO_MODELS.map((model): Model<Api> => ({
        id: model.id,
        name: model.name,
        api: 'openai-completions',
        provider: 'kilo',
        baseUrl: KILO_BASE_URL,
        reasoning: true,
        input: model.image ? ['text', 'image'] : ['text'],
        cost: NO_COST,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
    }),
  ]
}

/**
 * The curated catalog provider ids.
 * @returns the curated provider ids in curation order.
 */
export function harnessCatalogProviderIds(): readonly string[] {
  return harnessCatalogProviders().map(provider => provider.id)
}

/**
 * The curated catalog models for one route, indexed by model id.
 * @param provider - provider route key.
 * @returns the curated models by id, or `undefined` for a route this module
 *   does not curate — including pi-ai's own, which answers through the
 *   installed catalog.
 */
export function harnessCatalogModels(provider: string): Map<string, Model<Api>> | undefined {
  const curated = harnessCatalogProviders().find(entry => entry.id === provider)
  if (curated === undefined) return undefined
  return new Map(curated.getModels().map(model => [model.id, model]))
}

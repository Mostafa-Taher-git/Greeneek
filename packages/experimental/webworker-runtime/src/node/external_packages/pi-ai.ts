/**
 * `@earendil-works/pi-ai` stub, including its `/providers/all` and `/api/*.lazy`
 * subpaths. The package is Node-only (no `require`/`browser` conditions, Node
 * builtins plus five cloud SDKs in its transport layer) and `llm-pi-ai` imports it
 * statically at module scope, so the row cannot mount without it.
 *
 * Every symbol `llm-pi-ai` imports by name is present: a missing CommonJS symbol
 * would surface as `undefined` at call time instead of a link error. The three catalog readers
 * return empty collections rather than throwing — the row reads them while it
 * activates, and "this deployment ships no pi-ai provider" is the truth here.
 * The curated `kilo` route the harness catalog adds mounts through pi-ai
 * factories too, so the provider factory and the auth helper answer
 * structurally and their stand-ins refuse when the transport behind them is
 * reached. Everything on a request path is loud.
 */
import { notAvailableError, notImplementedFail } from '../notImplementedFail.ts'

const MODULE = '@earendil-works/pi-ai'

/**
 * Structural provider the harness catalog enumerates while the row activates:
 * pi-ai's factory is not reached for its transport, only for the descriptor
 * fields providers and catalog models are read from. Requests delegate to the
 * loud stream members, because request transport is unavailable here.
 * @param input - the descriptor fields a catalog or route profile carries.
 * @returns a provider shape with the same fields plus its model list getter.
 */
export function createProvider(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    getModels: (): readonly unknown[] =>
      Array.isArray(input.models) ? [...(input.models as readonly unknown[])] : [],
    stream: notImplementedFail(MODULE, 'stream'),
    streamSimple: notImplementedFail(MODULE, 'streamSimple'),
  }
}

/** Model-list factory (unavailable). */
export const createModels = notImplementedFail(MODULE, 'createModels')

/** Thinking-level catalog (unavailable). */
export const getSupportedThinkingLevels = notImplementedFail(MODULE, 'getSupportedThinkingLevels')

/** Context-overflow predicate (unavailable). */
export const isContextOverflow = notImplementedFail(MODULE, 'isContextOverflow')

/**
 * Structural api-key auth for a curated catalog route. The stub does not carry
 * pi-ai's credential store, so every resolution reads as unconfigured — the
 * worker host resolves route credentials through the harness's own auth seam
 * instead.
 * @param name - display name pi-ai would label the route's auth with.
 * @param envVars - environment variables the real helper would read.
 * @returns the marker shape route authentication filters on.
 */
export function envApiKeyAuth(name: string, _envVars: readonly string[]): unknown {
  return {
    name,
    login: notImplementedFail(MODULE, 'envApiKeyAuth().login'),
    resolve: async (): Promise<undefined> => undefined,
  }
}

/**
 * One wire-protocol implementation object the provider factory embeds. Only
 * referenced while a route is built; any member the transport would call
 * refuses while naming the protocol it belongs to.
 * @param symbol - the imported protocol factory the route names.
 * @returns the inert implementation object.
 */
function inertProtocol(symbol: string): unknown {
  return new Proxy({}, {
    get: () => { throw notAvailableError(MODULE, symbol) },
    has: () => { throw notAvailableError(MODULE, symbol) },
  })
}

/** Anthropic messages API implementation (unavailable on any request). */
export function anthropicMessagesApi(): unknown {
  return inertProtocol('anthropicMessagesApi')
}

/** OpenAI completions API implementation (unavailable on any request). */
export function openAICompletionsApi(): unknown {
  return inertProtocol('openAICompletionsApi')
}

/** OpenAI responses API implementation (unavailable on any request). */
export function openAIResponsesApi(): unknown {
  return inertProtocol('openAIResponsesApi')
}

/** Builtin provider ids of pi-ai 0.84.2, in catalog order. */
const BUILTIN_PROVIDER_IDS: readonly string[] = [
  'amazon-bedrock', 'ant-ling', 'anthropic', 'azure-openai-responses', 'baseten', 'cerebras',
  'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'greeneek', 'fireworks', 'github-copilot',
  'google', 'google-vertex', 'groq', 'huggingface', 'kimi-coding', 'minimax', 'minimax-cn',
  'mistral', 'moonshotai', 'moonshotai-cn', 'nvidia', 'openai', 'openai-codex', 'opencode',
  'opencode-go', 'openrouter', 'qwen-token-plan', 'qwen-token-plan-cn',
  'qwen-token-plan-individual', 'together',
  'vercel-ai-gateway', 'xai', 'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp', 'zai', 'zai-coding-cn',
]

/**
 * Installed catalog providers, read while `llm-pi-ai` activates. Each carries the
 * api-key auth marker the adapter filters on, and no models: the provider
 * directory therefore matches the served deployment while every request path
 * lands on a loud symbol above.
 * @returns one entry per builtin provider.
 */
export function builtinProviders(): unknown[] {
  return BUILTIN_PROVIDER_IDS.map(id => ({
    id,
    name: id,
    auth: { apiKey: { type: 'api-key' } },
    models: [],
  }))
}

/**
 * Provider route ids of the installed catalog. `llm-pi-ai` registers the whole
 * catalog as configurable the moment it mounts and rejects an empty
 * registration, so these are pi-ai's real ids rather than an empty list.
 * @returns the builtin provider ids.
 */
export function getBuiltinProviders(): string[] {
  return [...BUILTIN_PROVIDER_IDS]
}

/**
 * Models of one installed catalog provider.
 * @returns no models.
 */
export function getBuiltinModels(): unknown[] {
  return []
}

/** CommonJS interop marker: the worker loader hands `default` to default imports. */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  createProvider, createModels, envApiKeyAuth, getSupportedThinkingLevels, isContextOverflow,
  builtinProviders, getBuiltinModels, getBuiltinProviders, anthropicMessagesApi,
  openAICompletionsApi, openAIResponsesApi,
}

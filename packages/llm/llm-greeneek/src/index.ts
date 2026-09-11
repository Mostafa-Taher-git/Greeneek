/**
 * Register a {@link GreeneekAdapter} for the `greeneek-official` provider route on
 * `ctx.llm`, with connection facts resolved per request instead of frozen at
 * load: the plugin layers its `cordis.yml` entry config under the optional
 * `llm-greeneek` user-settings section (`ctx.settings`) and resolves the API
 * key through the optional credential seam (`ctx.credentials`), so a changed
 * base URL, catalog, or key reaches the very next request without restarting
 * anything, while an in-flight stream keeps the facts it started with. The
 * one registration-captured fact — the retry policy — re-registers the route
 * in place when it changes.
 * @module @greeneek/gnk-llm-greeneek
 */

import type { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess, resolveRetryPolicy, RetryPolicySchema } from '@greeneek/gnk-llm'
import type { ModelModality, RetryPolicyConfig } from '@greeneek/gnk-llm'
import type {} from '@greeneek/gnk-fs'
import { credentialRef } from '@greeneek/gnk-credentials'
import { assertEgressAllowed } from '@greeneek/gnk-egress'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@greeneek/gnk-launch-environment'
import type {} from '@greeneek/gnk-settings'
import { MAX_TIMER_DELAY_MS } from '@greeneek/gnk-timeout'
import { deepEqualJson } from '@greeneek/gnk-util-values'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@greeneek/gnk-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GreeneekAdapter,
} from './adapter.ts'
import type { GreeneekCatalogModel, GreeneekConnectionOptions } from './adapter.ts'
import {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
} from './request-pricing.ts'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GreeneekAdapter,
} from './adapter.ts'
export type { GreeneekAdapterOptions, GreeneekCatalogModel, GreeneekConnectionOptions } from './adapter.ts'
export {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  greeneekImageRequestPricing,
  resolveRequestImagePolicy,
} from './request-pricing.ts'
export { greeneekImageTokens } from './image-tokens.ts'
export { GreeneekFileStore, MAX_CHAT_IMAGE_BYTES } from './file-store.ts'
export type { GreeneekFileConnection, GreeneekFilePolicy, GreeneekFileReference } from './file-store.ts'
export { GreeneekFilesClient, MAX_FILE_EXPIRY_SECONDS, MAX_FILE_UPLOAD_BYTES, MAX_STORED_FILE_BYTES, MAX_STORED_FILE_COUNT, MIN_FILE_EXPIRY_SECONDS } from './files-api.ts'
export type { GreeneekFileObject, GreeneekFilePage } from './files-api.ts'
export { GreeneekFileId } from './file-id.ts'
export type { GreeneekFileId as GreeneekFileIdType } from './file-id.ts'
export { GreeneekUploadIndex, greeneekFileScope } from './upload-index.ts'
export type { GreeneekUploadRecord } from './upload-index.ts'
export type { RequestDefaults } from './serialize.ts'
export type * from './types.ts'

export const name = 'llm-greeneek'
export const inject = ['llm']

const NS = 'llm-greeneek'
const DEFAULT_API_KEY_ENV = 'GREENEEK_API_KEY'
/** The single provider route this plugin owns. */
const PROVIDER = 'greeneek-official'

const DEFAULT_MODELS: GreeneekCatalogModel[] = [
  {
    id: 'greeneek-v4-flash',
    name: 'Greeneek-V4-Flash',
    description: 'Fast, efficient, and economical; suited to focused, routine, or parallel tasks.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
  {
    id: 'greeneek-v4-pro',
    name: 'Greeneek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
  {
    id: 'greeneek-v4-flash-vision-exp',
    name: 'Greeneek-V4-Flash-Vision-Exp',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    inputModalities: ['text', 'image'],
    imagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    imageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  },
]

const MODEL_MODALITIES = ['text', 'image'] as const satisfies readonly ModelModality[]

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-greeneek` settings-section shape. Every field is optional in
 * yml: a missing API key resolves through {@link Config.apiKeyEnv} at each
 * request (a request without any key fails with `MISSING_CREDENTIAL`, not at
 * plugin load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `GREENEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; falls back to $GREENEEK_BASE_URL from a trusted environment layer, then the public API. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Flash, V4 Pro, and V4 Flash Vision Exp. */
  models?: GreeneekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Maximum accumulated file-referenced image bytes per chat request (default 128 MiB). */
  maxRequestFilesBytes?: number
  /** Maximum accumulated base64 image payload after Files API fallback (default 20 MiB). */
  maxInlineRequestImageBytes?: number
  /** Maximum number of represented images per chat request (default 600). */
  maxImagesPerRequest?: number
  /** Raw-byte removal step after the request exceeds its file bound (default 64 MiB). */
  imageOffloadByteQuantum?: number
  /** Base64-byte removal step after inline fallback exceeds its bound (default 10 MiB). */
  inlineImageOffloadByteQuantum?: number
  /** Image-count removal step after the request exceeds its count bound (default 20). */
  imageOffloadCountQuantum?: number
  /** Maximum duration of one request-image Files API resolution (default one minute). */
  filesApiTimeoutMs?: number
  /** Explicit lifetime assigned to each uploaded image (default seven days). */
  fileExpiresAfterSeconds?: number
  /** Remaining lifetime below which an indexed file is replaced (default one hour). */
  fileRefreshMarginSeconds?: number
  /** Oldest harness-owned files deleted before one quota-recovery upload retry (default 100). */
  fileQuotaCleanupBatch?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

const catalogModel: z<GreeneekCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text']),
  imagePixelBudget: z.union([z.number().step(1).min(1), 'low']),
  imageMaxBytes: z.number().step(1).min(1),
})

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'low', 'high', 'max']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestFilesBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_FILES_BYTES),
  maxInlineRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES),
  maxImagesPerRequest: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_REQUEST),
  imageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM),
  inlineImageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM),
  imageOffloadCountQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM),
  filesApiTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_FILES_API_TIMEOUT_MS),
  fileExpiresAfterSeconds: z.number().step(1).min(3_600).max(2_592_000).default(DEFAULT_FILE_EXPIRY_SECONDS),
  fileRefreshMarginSeconds: z.number().step(1).min(0).default(DEFAULT_FILE_REFRESH_MARGIN_SECONDS),
  fileQuotaCleanupBatch: z.number().step(1).min(1).max(1_000).default(DEFAULT_FILE_QUOTA_CLEANUP_BATCH),
  retryPolicy: RetryPolicySchema,
})

/** Public API default; the internal endpoint comes from $GREENEEK_BASE_URL. */
export const PUBLIC_BASE_URL = 'https://api.greeneek.dev'

/** Environment variable naming this provider's endpoint, honored only from trusted layers. */
const BASE_URL_ENV = 'GREENEEK_BASE_URL'

/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedGreeneekOptions = GreeneekConnectionOptions

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly GreeneekCatalogModel[] | undefined): GreeneekCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (Object.hasOwn(model, 'imageDetail')) {
      throw new Error('llm-greeneek: catalog model imageDetail is no longer supported; use imagePixelBudget')
    }
    if (model.id.length === 0) throw new Error('llm-greeneek: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-greeneek: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-greeneek: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-greeneek: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    const inputModalities = model.inputModalities ?? ['text']
    if (inputModalities.length === 0) {
      throw new Error(`llm-greeneek: catalog model "${model.id}" inputModalities must not be empty`)
    }
    if (inputModalities.some(modality => !MODEL_MODALITIES.includes(modality))) {
      throw new Error(
        `llm-greeneek: catalog model "${model.id}" inputModalities must contain only "text" and "image"`,
      )
    }
    if (new Set(inputModalities).size !== inputModalities.length) {
      throw new Error(`llm-greeneek: catalog model "${model.id}" inputModalities must not contain duplicates`)
    }
    const hasImage = inputModalities.includes('image')
    if (!hasImage && (model.imagePixelBudget !== undefined || model.imageMaxBytes !== undefined)) {
      throw new Error(`llm-greeneek: text-only catalog model "${model.id}" cannot declare image request limits`)
    }
    if (model.imagePixelBudget !== undefined
      && model.imagePixelBudget !== 'low'
      && (!Number.isSafeInteger(model.imagePixelBudget) || model.imagePixelBudget <= 0)) {
      throw new Error(`llm-greeneek: catalog model "${model.id}" imagePixelBudget must be "low" or a positive safe integer`)
    }
    if (model.imageMaxBytes !== undefined
      && (!Number.isSafeInteger(model.imageMaxBytes) || model.imageMaxBytes <= 0)) {
      throw new Error(`llm-greeneek: catalog model "${model.id}" imageMaxBytes must be a positive safe integer`)
    }
    if (seen.has(model.id)) throw new Error(`llm-greeneek: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      inputModalities: [...inputModalities],
      ...hasImage
        ? {
          imagePixelBudget: model.imagePixelBudget === 'low'
            ? DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET
            : model.imagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
          imageMaxBytes: model.imageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
        }
        : {},
    }
  })
}

/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. Every layer may supply an endpoint: the product trusts the
 * project it is launched in, so a checkout can point its own agent at the
 * gateway that checkout is meant to use.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(config: Config, environment?: LaunchEnvironmentSnapshot): ResolvedGreeneekOptions {
  if (config.thinking === 'disabled'
    && config.reasoningEffort !== undefined
    && config.reasoningEffort !== 'off') {
    throw new Error('llm-greeneek: only reasoningEffort "off" can be configured when thinking is disabled')
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-greeneek: defaultContextWindow must be a positive integer')
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-greeneek: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-greeneek: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const maxRequestFilesBytes = config.maxRequestFilesBytes ?? DEFAULT_MAX_REQUEST_FILES_BYTES
  if (!Number.isSafeInteger(maxRequestFilesBytes) || maxRequestFilesBytes <= 0) {
    throw new Error('llm-greeneek: maxRequestFilesBytes must be a positive safe integer')
  }
  const maxInlineRequestImageBytes = config.maxInlineRequestImageBytes ?? DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES
  if (!Number.isSafeInteger(maxInlineRequestImageBytes) || maxInlineRequestImageBytes <= 0) {
    throw new Error('llm-greeneek: maxInlineRequestImageBytes must be a positive safe integer')
  }
  const maxImagesPerRequest = config.maxImagesPerRequest ?? DEFAULT_MAX_IMAGES_PER_REQUEST
  if (!Number.isSafeInteger(maxImagesPerRequest) || maxImagesPerRequest <= 0) {
    throw new Error('llm-greeneek: maxImagesPerRequest must be a positive safe integer')
  }
  const imageOffloadByteQuantum = config.imageOffloadByteQuantum ?? DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM
  if (!Number.isSafeInteger(imageOffloadByteQuantum) || imageOffloadByteQuantum <= 0) {
    throw new Error('llm-greeneek: imageOffloadByteQuantum must be a positive safe integer')
  }
  if (imageOffloadByteQuantum > maxRequestFilesBytes) {
    throw new Error('llm-greeneek: imageOffloadByteQuantum must not exceed maxRequestFilesBytes')
  }
  const inlineImageOffloadByteQuantum = config.inlineImageOffloadByteQuantum
    ?? DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM
  if (!Number.isSafeInteger(inlineImageOffloadByteQuantum) || inlineImageOffloadByteQuantum <= 0) {
    throw new Error('llm-greeneek: inlineImageOffloadByteQuantum must be a positive safe integer')
  }
  if (inlineImageOffloadByteQuantum > maxInlineRequestImageBytes) {
    throw new Error('llm-greeneek: inlineImageOffloadByteQuantum must not exceed maxInlineRequestImageBytes')
  }
  const imageOffloadCountQuantum = config.imageOffloadCountQuantum ?? DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM
  if (!Number.isSafeInteger(imageOffloadCountQuantum) || imageOffloadCountQuantum <= 0) {
    throw new Error('llm-greeneek: imageOffloadCountQuantum must be a positive safe integer')
  }
  if (imageOffloadCountQuantum > maxImagesPerRequest) {
    throw new Error('llm-greeneek: imageOffloadCountQuantum must not exceed maxImagesPerRequest')
  }
  const filesApiTimeoutMs = config.filesApiTimeoutMs ?? DEFAULT_FILES_API_TIMEOUT_MS
  if (!Number.isFinite(filesApiTimeoutMs)
    || filesApiTimeoutMs <= 0
    || filesApiTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-greeneek: filesApiTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const fileExpiresAfterSeconds = config.fileExpiresAfterSeconds ?? DEFAULT_FILE_EXPIRY_SECONDS
  if (!Number.isSafeInteger(fileExpiresAfterSeconds)
    || fileExpiresAfterSeconds < 3_600
    || fileExpiresAfterSeconds > 2_592_000) {
    throw new Error('llm-greeneek: fileExpiresAfterSeconds must be an integer from 3600 through 2592000')
  }
  const fileRefreshMarginSeconds = config.fileRefreshMarginSeconds ?? DEFAULT_FILE_REFRESH_MARGIN_SECONDS
  if (!Number.isSafeInteger(fileRefreshMarginSeconds)
    || fileRefreshMarginSeconds < 0
    || fileRefreshMarginSeconds >= fileExpiresAfterSeconds) {
    throw new Error('llm-greeneek: fileRefreshMarginSeconds must be a non-negative integer below fileExpiresAfterSeconds')
  }
  const fileQuotaCleanupBatch = config.fileQuotaCleanupBatch ?? DEFAULT_FILE_QUOTA_CLEANUP_BATCH
  if (!Number.isSafeInteger(fileQuotaCleanupBatch)
    || fileQuotaCleanupBatch < 1
    || fileQuotaCleanupBatch > 1_000) {
    throw new Error('llm-greeneek: fileQuotaCleanupBatch must be an integer from 1 through 1000')
  }
  const baseURL = config.baseURL
    ?? environment?.get(BASE_URL_ENV)?.value
    ?? PUBLIC_BASE_URL
  // The egress guard validates the resolved endpoint (absolute URL, plus the
  // strict-mode allow-list when enabled); no provider is blocked by default.
  assertEgressAllowed(baseURL)
  return {
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL,
    defaults: {
      thinking: config.thinking,
      reasoningEffort: config.reasoningEffort,
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    maxRequestFilesBytes,
    maxInlineRequestImageBytes,
    maxImagesPerRequest,
    imageOffloadByteQuantum,
    inlineImageOffloadByteQuantum,
    imageOffloadCountQuantum,
    filesApiTimeoutMs,
    filePolicy: {
      expiresAfterSeconds: fileExpiresAfterSeconds,
      refreshMarginSeconds: fileRefreshMarginSeconds,
      quotaCleanupBatch: fileQuotaCleanupBatch,
    },
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-greeneek: retryPolicy'),
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedGreeneekOptions | undefined
  const options = (): ResolvedGreeneekOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-greeneek: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const resolveApiKey = async (connection: ResolvedGreeneekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-greeneek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-greeneek', ref)
      }
    }
    throw new LlmError(
      `llm-greeneek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new GreeneekAdapter({
    options,
    resolveApiKey,
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    prepareExtensions: (request) => {
      const extensions = ctx.get('greeneekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Greeneek', settingsNs: NS, settingsPath: [] },
  ])
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: ensureRegistrationFacts,
    })
  })
}

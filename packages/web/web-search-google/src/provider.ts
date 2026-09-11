/**
 * `GoogleSearchProvider`: a `WebSearchProvider` backed by Google's
 * Programmable Search JSON API (`GET /customsearch/v1` with key + cx). It
 * maps each item's `link` to `url`, keeps a non-blank `title` and `snippet`
 * when present, drops entries with a blank link, and omits `content`
 * because Google returns no generated answer.
 * @module @greeneek/gnk-web-search-google/provider
 */

import { WebError } from '@greeneek/gnk-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@greeneek/gnk-web'
import type { GoogleError, GoogleResult, GoogleSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const GOOGLE_PROVIDER_ID = 'google'

/** Default Google API endpoint base; `/customsearch/v1` is the operation. */
export const GOOGLE_DEFAULT_BASE_URL = 'https://www.googleapis.com'

/** Upper bound Google's `num` parameter accepts per request. */
export const GOOGLE_MAX_NUM = 10

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'greeneek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface GoogleSearchProviderOptions {
  /** Google API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Programmable Search engine id (cx). Empty/absent makes the provider unavailable. */
  searchEngineId: string
  /** Endpoint base; `/customsearch/v1` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
}

/**
 * Map one Google result to a normalized source, or `undefined` when its link
 * is blank — the seam has no other field to derive a URL from, and inventing
 * one would lie.
 *
 * @param result - one entry of Google's `items[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank link.
 */
export function mapGoogleResult(result: GoogleResult): WebSearchSource | undefined {
  if (result.link.trim().length === 0) return undefined
  return {
    url: result.link,
    ...result.title != null && result.title.trim().length > 0 ? { title: result.title } : {},
    ...result.snippet != null && result.snippet.trim().length > 0 ? { snippet: result.snippet } : {},
  }
}

/**
 * Type-guard one parsed item: the wire may return a well-formed envelope of
 * the wrong shape, which must fail as a provider error, not a raw TypeError.
 * @param value - one entry of the parsed `items[]`.
 * @returns true when the entry is a mappable Google result.
 */
function isGoogleResult(value: unknown): value is GoogleResult {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { link?: unknown }).link === 'string'
}

/**
 * Map a Google response envelope to a normalized search result.
 *
 * @param response - the parsed `GET /customsearch/v1` response body.
 * @returns the normalized result; blank-link entries are dropped
 *   ({@link mapGoogleResult}).
 * @throws {WebError} `WEB_PROVIDER_ERROR` when the envelope is not a
 *   mappable Google response.
 */
export function mapGoogleResponse(response: GoogleSearchResponse): WebSearchResult {
  const items = response.items ?? []
  if (!Array.isArray(items) || !items.every(isGoogleResult)) {
    throw new WebError('Google returned an unprocessable response body: items[] has the wrong shape', 'WEB_PROVIDER_ERROR')
  }
  const sources = items
    .map(mapGoogleResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Google returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Google-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class GoogleSearchProvider implements WebSearchProvider {
  readonly id = GOOGLE_PROVIDER_ID

  constructor(private readonly options: GoogleSearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && this.options.searchEngineId.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    // Google's `num` caps at 10 — the seam still enforces the final bound on return.
    const wanted = request.maxResults ?? this.options.numResults
    const num = wanted === undefined ? undefined : Math.min(Math.max(wanted, 1), GOOGLE_MAX_NUM)
    const params = new URLSearchParams({
      key: this.options.apiKey,
      cx: this.options.searchEngineId,
      q: request.query,
      ...num !== undefined ? { num: String(num) } : {},
    })
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/customsearch/v1?${params.toString()}`, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Google search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Google API error (HTTP ${status})`
      try {
        const parsed = await response.json() as GoogleError
        const detail = parsed.error?.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as GoogleSearchResponse
      return mapGoogleResponse(payload)
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      if (isAbortError(error)) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Google returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Google (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

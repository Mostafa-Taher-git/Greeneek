/**
 * `DuckDuckGoSearchProvider`: a `WebSearchProvider` backed by DuckDuckGo's
 * keyless Instant Answer API (`GET /?q=&format=json`). It maps the abstract
 * to the first source, related-topic blurbs to further sources, and a
 * non-blank instant `Answer` to `content` (the provider's own answer, not an
 * invention). Entries with a blank URL are dropped.
 * @module @greeneek/gnk-web-search-duckduckgo/provider
 */

import { WebError } from '@greeneek/gnk-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@greeneek/gnk-web'
import type { DuckDuckGoSearchResponse, DuckDuckGoTopic } from './types.ts'

/** Stable id this provider registers under. */
export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'

/** Default DuckDuckGo Instant Answer endpoint base; `/` is the operation. */
export const DUCKDUCKGO_DEFAULT_BASE_URL = 'https://api.duckduckgo.com'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'greeneek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies constant defaults). */
export interface DuckDuckGoSearchProviderOptions {
  /** Endpoint base; `/` is queried. */
  baseURL: string
}

/**
 * Map one related-topic blurb to a normalized source, or `undefined` when it
 * carries no non-blank link — the seam has no other field to derive a URL
 * from, and inventing one would lie.
 *
 * @param topic - one entry of `RelatedTopics[]` (or a nested `Topics[]`).
 * @returns the normalized source, or `undefined` for grouping entries and
 *   entries with a blank link.
 */
export function mapDuckDuckGoTopic(topic: DuckDuckGoTopic): WebSearchSource | undefined {
  if (topic.FirstURL == null || topic.FirstURL.trim().length === 0) return undefined
  return {
    url: topic.FirstURL,
    ...topic.Text != null && topic.Text.trim().length > 0 ? { snippet: topic.Text } : {},
  }
}

/**
 * Type-guard a topic list: the wire may return a well-formed envelope of the
 * wrong shape, which must fail as a provider error, not a raw TypeError.
 * @param value - the parsed `RelatedTopics` or nested `Topics` value.
 * @returns true when the value is an array of topic entries.
 */
function isTopicArray(value: unknown): value is DuckDuckGoTopic[] {
  return Array.isArray(value)
}

/**
 * Map a DuckDuckGo response envelope to a normalized search result.
 *
 * @param response - the parsed Instant Answer response body.
 * @returns the normalized result: the abstract first (when it names a
 *   source), then flattened related-topic sources; a non-blank instant
 *   `Answer` becomes `content`.
 * @throws {WebError} `WEB_PROVIDER_ERROR` when the envelope is not a
 *   mappable DuckDuckGo response.
 */
export function mapDuckDuckGoResponse(response: DuckDuckGoSearchResponse): WebSearchResult {
  const envelope: unknown = response
  if (typeof envelope !== 'object' || envelope === null) {
    throw new WebError('DuckDuckGo returned an unprocessable response body: envelope has the wrong shape', 'WEB_PROVIDER_ERROR')
  }
  const sources: WebSearchSource[] = []
  const abstractUrl = response.AbstractURL ?? ''
  const abstractText = response.AbstractText ?? ''
  if (abstractUrl.trim().length > 0) {
    const sourceName = response.AbstractSource ?? ''
    sources.push({
      url: abstractUrl,
      ...sourceName.trim().length > 0 ? { title: sourceName } : {},
      ...abstractText.trim().length > 0 ? { snippet: abstractText } : {},
    })
  }
  const related: unknown = response.RelatedTopics ?? []
  if (!isTopicArray(related)) {
    throw new WebError('DuckDuckGo returned an unprocessable response body: RelatedTopics has the wrong shape', 'WEB_PROVIDER_ERROR')
  }
  for (const topic of related) {
    // A grouping entry carries nested Topics[] instead of its own link; keep
    // wire order by mapping the entry itself before its nested topics.
    const mapped = mapDuckDuckGoTopic(topic)
    if (mapped !== undefined) sources.push(mapped)
    const nested: unknown = topic.Topics ?? []
    if (!isTopicArray(nested)) {
      throw new WebError('DuckDuckGo returned an unprocessable response body: Topics has the wrong shape', 'WEB_PROVIDER_ERROR')
    }
    for (const entry of nested) {
      const nestedMapped = mapDuckDuckGoTopic(entry)
      if (nestedMapped !== undefined) sources.push(nestedMapped)
    }
  }
  // DuckDuckGo's instant answer (calculations, conversions) is the provider's
  // own answer text, so it maps to `content`. The web service owns the final
  // `maxResults` truncation, so this provider reports `truncated: false`.
  const answer = response.Answer ?? ''
  return {
    sources,
    truncated: false,
    ...answer.trim().length > 0 ? { content: answer } : {},
  }
}

/** The DuckDuckGo-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = DUCKDUCKGO_PROVIDER_ID

  constructor(private readonly options: DuckDuckGoSearchProviderOptions) {}

  /** Keyless by design: usable whenever the endpoint base parses. */
  available(): boolean {
    return isValidBaseUrl(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // The Instant Answer API takes no result-count parameter; the seam
    // truncates the fixed set on return.
    const params = new URLSearchParams({
      q: request.query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    })
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/?${params.toString()}`, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `DuckDuckGo API error (HTTP ${status})`
      try {
        const text = await response.text()
        if (text.trim().length > 0) message = `${message}: ${text.slice(0, 200)}`
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as DuckDuckGoSearchResponse
      return mapDuckDuckGoResponse(payload)
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

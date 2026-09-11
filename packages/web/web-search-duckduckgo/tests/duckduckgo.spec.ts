import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import WebRuntime from '@greeneek/gnk-web'
import { DuckDuckGoSearchProvider, DUCKDUCKGO_PROVIDER_ID } from '@greeneek/gnk-web-search-duckduckgo'
import * as duckduckgoPlugin from '@greeneek/gnk-web-search-duckduckgo'
import { mapDuckDuckGoResponse, mapDuckDuckGoTopic } from '../src/provider.ts'

const options = { baseURL: 'https://api.duckduckgo.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DuckDuckGo topic mapping', () => {
  it('maps a full topic entry', () => {
    expect(mapDuckDuckGoTopic({ Text: 'Ada Lovelace — programmer', FirstURL: 'https://a.test' }))
      .toEqual({ url: 'https://a.test', snippet: 'Ada Lovelace — programmer' })
  })

  it('drops grouping entries and blank links', () => {
    expect(mapDuckDuckGoTopic({ Name: 'Group', Topics: [{ Text: 't', FirstURL: 'https://a.test' }] })).toBeUndefined()
    expect(mapDuckDuckGoTopic({ Text: 't', FirstURL: '  ' })).toBeUndefined()
    expect(mapDuckDuckGoTopic({})).toBeUndefined()
  })

  it('omits blank text rather than emitting it', () => {
    expect(mapDuckDuckGoTopic({ Text: '  ', FirstURL: 'https://a.test' })).toEqual({ url: 'https://a.test' })
  })
})

describe('DuckDuckGo response mapping', () => {
  it('maps abstract, answer, topics, and nested group topics in order', () => {
    const result = mapDuckDuckGoResponse({
      AbstractText: 'Ada was a programmer',
      AbstractURL: 'https://abstract.test',
      AbstractSource: 'Wikipedia',
      Answer: '2 + 2 is 4',
      RelatedTopics: [
        { Text: 'first blurb', FirstURL: 'https://a.test' },
        { Text: 'blank', FirstURL: '  ' },
        { Name: 'Group', Topics: [{ Text: 'nested blurb', FirstURL: 'https://nested.test' }] },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://abstract.test', title: 'Wikipedia', snippet: 'Ada was a programmer' },
        { url: 'https://a.test', snippet: 'first blurb' },
        { url: 'https://nested.test', snippet: 'nested blurb' },
      ],
      truncated: false,
      content: '2 + 2 is 4',
    })
  })

  it('omits content when the instant answer is blank', () => {
    const result = mapDuckDuckGoResponse({ AbstractText: '', AbstractURL: '', Answer: '  ', RelatedTopics: [] })
    expect(result).toEqual({ sources: [], truncated: false })
    expect(result.content).toBeUndefined()
  })

  it('maps an abstract without text or source name to a bare URL source', () => {
    const result = mapDuckDuckGoResponse({ AbstractURL: 'https://abstract.test', RelatedTopics: [] })
    expect(result.sources).toEqual([{ url: 'https://abstract.test' }])
  })

  it('tolerates a missing RelatedTopics array', () => {
    expect(mapDuckDuckGoResponse({}).sources).toEqual([])
  })

  it('drops blank-link entries nested inside a topic group', () => {
    const result = mapDuckDuckGoResponse({
      RelatedTopics: [
        { Name: 'Group', Topics: [{ Text: 'blank', FirstURL: '  ' }, { Text: 'kept', FirstURL: 'https://kept.test' }] },
      ],
    })
    expect(result.sources).toEqual([{ url: 'https://kept.test', snippet: 'kept' }])
  })

  it('rejects a non-object envelope as a provider error, not a raw TypeError', () => {
    expect(() => mapDuckDuckGoResponse(null as never)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('rejects a non-array RelatedTopics as a provider error', () => {
    expect(() => mapDuckDuckGoResponse({ RelatedTopics: {} as never }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('rejects non-array nested Topics as a provider error', () => {
    expect(() => mapDuckDuckGoResponse({ RelatedTopics: [{ Topics: {} as never }] }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('DuckDuckGoSearchProvider availability', () => {
  it('is available out of the box: no key exists', () => {
    expect(new DuckDuckGoSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new DuckDuckGoSearchProvider({ baseURL: 'not a url' }).available()).toBe(false)
  })
})

describe('DuckDuckGoSearchProvider request mapping', () => {
  it('sends the query as Instant Answer params without redirect following', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ RelatedTopics: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new DuckDuckGoSearchProvider(options)
    await provider.search({ query: 'hello' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://api.duckduckgo.test/')
    expect(parsed.searchParams.get('q')).toBe('hello')
    expect(parsed.searchParams.get('format')).toBe('json')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ RelatedTopics: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new DuckDuckGoSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('DuckDuckGoSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'DuckDuckGo API error (HTTP 502): down' }))
  })

  it('keeps the status-line message when the error body is blank', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('  ', { status: 503 })))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'DuckDuckGo API error (HTTP 503)' }))
  })

  it('keeps the status-line message when the error-body read itself fails', async () => {
    const body = { text: () => Promise.reject(new TypeError('broken')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'DuckDuckGo API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ RelatedTopics: {} }, { status: 200 })))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body read as WEB_ABORTED', async () => {
    const body = { text: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-duckduckgo plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ RelatedTopics: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: DUCKDUCKGO_PROVIDER_ID })
    const fiber = await ctx.plugin(duckduckgoPlugin, {})
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in duckduckgoPlugin).toBe(false)
  })

  it('auto-selects with no configured id: the only usable provider wins', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ RelatedTopics: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await ctx.plugin(duckduckgoPlugin, {})
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
  })

  it('uses the default base URL when config omits it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ RelatedTopics: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: DUCKDUCKGO_PROVIDER_ID })
    const fiber = await ctx.plugin(duckduckgoPlugin, {})
    await ctx.web.search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url.startsWith('https://api.duckduckgo.com/?')).toBe(true)
    await fiber.dispose()
  })
})

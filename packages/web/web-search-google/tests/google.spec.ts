import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import WebRuntime from '@greeneek/gnk-web'
import { GoogleSearchProvider, GOOGLE_MAX_NUM, GOOGLE_PROVIDER_ID } from '@greeneek/gnk-web-search-google'
import * as googlePlugin from '@greeneek/gnk-web-search-google'
import { mapGoogleResponse, mapGoogleResult } from '../src/provider.ts'

const options = { apiKey: 'google-key', searchEngineId: 'engine-id', baseURL: 'https://www.googleapis.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Google result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapGoogleResult({
      link: 'https://a.test',
      title: 'A',
      snippet: 'salient sentence',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'salient sentence' })
  })

  it('drops a result with a blank link', () => {
    expect(mapGoogleResult({ link: '  ' })).toBeUndefined()
  })

  it('omits null/blank optional fields rather than emitting them', () => {
    expect(mapGoogleResult({ link: 'https://a.test', title: null, snippet: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapGoogleResult({ link: 'https://a.test', title: ' ', snippet: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapGoogleResponse({
      items: [
        { link: 'https://a.test', snippet: 'one' },
        { link: '  ' },
        { link: 'https://c.test', title: 'C', snippet: 'three' },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing items array', () => {
    expect(mapGoogleResponse({}).sources).toEqual([])
  })
})

describe('GoogleSearchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new GoogleSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is unavailable without a search engine id', () => {
    expect(new GoogleSearchProvider({ ...options, searchEngineId: '' }).available()).toBe(false)
  })

  it('is available with a key and engine id', () => {
    expect(new GoogleSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new GoogleSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when numResults is set but not a positive integer', () => {
    expect(new GoogleSearchProvider({ ...options, numResults: -1 }).available()).toBe(false)
  })
})

describe('GoogleSearchProvider request mapping', () => {
  it('sends key, cx, query and num as URL params without redirect following', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ link: 'https://a.test', snippet: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GoogleSearchProvider(options)
    await provider.search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://www.googleapis.test/customsearch/v1')
    expect(parsed.searchParams.get('key')).toBe('google-key')
    expect(parsed.searchParams.get('cx')).toBe('engine-id')
    expect(parsed.searchParams.get('q')).toBe('hello')
    expect(parsed.searchParams.get('num')).toBe('5')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
  })

  it('clamps the wire num to the API maximum of 10', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider(options).search({ query: 'q', maxResults: 50 })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(new URL(url).searchParams.get('num')).toBe(String(GOOGLE_MAX_NUM))
  })

  it('falls back to the configured numResults when a request omits maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider({ ...options, numResults: 7 }).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(new URL(url).searchParams.get('num')).toBe('7')
  })

  it('lets a request maxResults win over the configured numResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider({ ...options, numResults: 7 }).search({ query: 'q', maxResults: 2 })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(new URL(url).searchParams.get('num')).toBe('2')
  })

  it('omits num when neither maxResults nor a configured default is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider(options).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(new URL(url).searchParams.has('num')).toBe(false)
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new GoogleSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('GoogleSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'bad key' } }, { status: 400 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Google API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Google API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: {} }, { status: 200 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('rejects non-result entries inside items[] as a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: ['x', null, { link: 42 }] }, { status: 200 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-google plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
    const fiber = await ctx.plugin(googlePlugin, { apiKey: 'k', searchEngineId: 'cx' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in googlePlugin).toBe(false)
  })

  it('threads searchEngineId and numResults config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
    const fiber = await ctx.plugin(googlePlugin, { apiKey: 'k', searchEngineId: 'cx-9', numResults: 3 })
    await ctx.web.search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    const params = new URL(url).searchParams
    expect(params.get('cx')).toBe('cx-9')
    expect(params.get('num')).toBe('3')
    await fiber.dispose()
  })

  it('falls back to env keys and the default base URL when config omits them', async () => {
    const prevKey = process.env.GOOGLE_SEARCH_API_KEY
    const prevCx = process.env.GOOGLE_SEARCH_ENGINE_ID
    process.env.GOOGLE_SEARCH_API_KEY = 'env-key'
    process.env.GOOGLE_SEARCH_ENGINE_ID = 'env-cx'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
      const fiber = await ctx.plugin(googlePlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url.startsWith('https://www.googleapis.com/customsearch/v1?')).toBe(true)
      const params = new URL(url).searchParams
      expect(params.get('key')).toBe('env-key')
      expect(params.get('cx')).toBe('env-cx')
      await fiber.dispose()
    } finally {
      if (prevKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY
      else process.env.GOOGLE_SEARCH_API_KEY = prevKey
      if (prevCx === undefined) delete process.env.GOOGLE_SEARCH_ENGINE_ID
      else process.env.GOOGLE_SEARCH_ENGINE_ID = prevCx
    }
  })

  it('is unavailable when neither config nor env supplies key and engine id', async () => {
    const prevKey = process.env.GOOGLE_SEARCH_API_KEY
    const prevCx = process.env.GOOGLE_SEARCH_ENGINE_ID
    delete process.env.GOOGLE_SEARCH_API_KEY
    delete process.env.GOOGLE_SEARCH_ENGINE_ID
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
      await ctx.plugin(googlePlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prevKey !== undefined) process.env.GOOGLE_SEARCH_API_KEY = prevKey
      if (prevCx !== undefined) process.env.GOOGLE_SEARCH_ENGINE_ID = prevCx
    }
  })
})

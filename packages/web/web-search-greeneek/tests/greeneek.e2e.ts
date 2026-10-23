import { describe, expect, it } from 'vitest'
import {
  GreeneekSearchProvider,
  GREENEEK_DEFAULT_API_VERSION,
  GREENEEK_DEFAULT_MAX_TOKENS,
  GREENEEK_DEFAULT_MAX_USES,
  GREENEEK_DEFAULT_MODEL,
} from '@greeneek/gnk-web-search-greeneek'

/** Construct the provider over a fixed options value; production passes a live thunk. */
import type { GreeneekSearchProviderOptions } from '@greeneek/gnk-web-search-greeneek'

const searchProvider = (options: GreeneekSearchProviderOptions): GreeneekSearchProvider =>
  new GreeneekSearchProvider(() => options)

/**
 * Disabled real-API probe for the Greeneek search provider. The live endpoint
 * can complete without structured source blocks, so this is not a reliable
 * merge signal. Its body remains because mocks cannot confirm the wire shape.
 */
const apiKey = process.env.GREENEEK_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('GreeneekSearchProvider real API', () => {
  it.skip('returns citeable sources for a live query via native web_search', async () => {
    // The endpoint always comes from the deployment; there is no shipped one.
    const baseURL = process.env.GREENEEK_SEARCH_BASE_URL
    if (baseURL === undefined || baseURL.length === 0) {
      throw new Error('real-API probe ran without GREENEEK_SEARCH_BASE_URL')
    }
    const provider = searchProvider({
      apiKey: apiKey!,
      baseURL,
      model: process.env.GREENEEK_SEARCH_MODEL ?? GREENEEK_DEFAULT_MODEL,
      apiVersion: GREENEEK_DEFAULT_API_VERSION,
      maxTokens: GREENEEK_DEFAULT_MAX_TOKENS,
      maxUses: GREENEEK_DEFAULT_MAX_USES,
    })
    const result = await provider.search({ query: 'What is Greeneek Harness?', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 60_000)
})

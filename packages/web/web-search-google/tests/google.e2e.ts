import { describe, expect, it } from 'vitest'
import { GoogleSearchProvider, GOOGLE_DEFAULT_BASE_URL } from '@greeneek/gnk-web-search-google'

/**
 * Real-API smoke for the Google search provider. Self-skips without
 * `$GOOGLE_SEARCH_API_KEY` and `$GOOGLE_SEARCH_ENGINE_ID` (CI has no
 * secrets), per the with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.GOOGLE_SEARCH_API_KEY
const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID
const maybe = apiKey !== undefined && apiKey.length > 0 && engineId !== undefined && engineId.length > 0
  ? describe
  : describe.skip

maybe('GoogleSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new GoogleSearchProvider({
      apiKey: apiKey as string,
      searchEngineId: engineId as string,
      baseURL: process.env.GOOGLE_SEARCH_BASE_URL ?? GOOGLE_DEFAULT_BASE_URL,
    })
    const result = await provider.search({ query: 'Greeneek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})

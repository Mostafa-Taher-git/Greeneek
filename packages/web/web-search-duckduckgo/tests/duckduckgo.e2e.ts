import { describe, expect, it } from 'vitest'
import { DuckDuckGoSearchProvider, DUCKDUCKGO_DEFAULT_BASE_URL } from '@greeneek/gnk-web-search-duckduckgo'

/**
 * Real-API smoke for the DuckDuckGo search provider. Keyless, so it runs
 * wherever the network allows — gated on `$DUCKDUCKGO_E2E=1` so hermetic
 * environments (and CI without network) skip it deterministically.
 */
const maybe = process.env.DUCKDUCKGO_E2E === '1' ? describe : describe.skip

maybe('DuckDuckGoSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new DuckDuckGoSearchProvider({
      baseURL: process.env.DUCKDUCKGO_BASE_URL ?? DUCKDUCKGO_DEFAULT_BASE_URL,
    })
    const result = await provider.search({ query: 'Ada Lovelace' })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})

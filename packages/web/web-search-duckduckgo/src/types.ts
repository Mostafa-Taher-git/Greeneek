/**
 * Wire types for DuckDuckGo's Instant Answer API (`GET {baseURL}/?q=&format=json`).
 * Types only — no runtime code. DuckDuckGo returns an abstract (a direct
 * topic summary with a source URL), an optional instant `Answer`, and a flat
 * `RelatedTopics[]` of linked blurbs; topic groups nest one level deeper.
 *
 * @module @greeneek/gnk-web-search-duckduckgo/types
 */

/** One linked blurb inside `RelatedTopics[]`. */
export interface DuckDuckGoTopic {
  /** Blurb text, usually starting with the topic title. */
  Text?: string | null
  /** Link the blurb points at. */
  FirstURL?: string | null
  /** Nested topics inside a named topic group. */
  Topics?: DuckDuckGoTopic[] | null
  /** Group name, present only on grouping entries. */
  Name?: string | null
}

/** DuckDuckGo's Instant Answer response envelope. */
export interface DuckDuckGoSearchResponse {
  /** Direct topic summary; blank when the query names no known topic. */
  AbstractText?: string | null
  /** Source URL the abstract was drawn from. */
  AbstractURL?: string | null
  /** Human source name behind the abstract (e.g. Wikipedia). */
  AbstractSource?: string | null
  /** Instant answer (calculations, conversions); blank for most queries. */
  Answer?: string | null
  RelatedTopics?: DuckDuckGoTopic[] | null
}

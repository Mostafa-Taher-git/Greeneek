/**
 * Wire types for Google's Programmable Search JSON API (`GET
 * {baseURL}/customsearch/v1`). Types only — no runtime code. Google returns a
 * flat `items[]`; each entry carries a `link` URL, optional `title`, and
 * optional `snippet`. Failures arrive as an `error` envelope with a message.
 *
 * @module @greeneek/gnk-web-search-google/types
 */

/** One entry of Google's flat `items[]`. */
export interface GoogleResult {
  /** Result URL. */
  link: string
  title?: string | null
  snippet?: string | null
}

/** Google's search response envelope. */
export interface GoogleSearchResponse {
  items?: GoogleResult[]
}

/** Google's error response envelope (best-effort; fields vary by failure). */
export interface GoogleError {
  error?: {
    message?: string
  }
}

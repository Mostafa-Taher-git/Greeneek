# @greeneek/gnk-tool-browser

Model-facing browser tools over `ctx.browser`: `browser_open`, `browser_navigate`,
`browser_snapshot`, `browser_read`, `browser_click`, `browser_close`. Navigation
and surface state stay on the shared authority; `browser_read`/`browser_click`
use a content-capable provider (Playwright) to read and navigate real pages.

## Model Experience

These tools add six schemas and one pinned guidance section to the model. All
page text is prefixed with an explicit untrusted-content notice and must never be
treated as instructions. Without a content-capable provider the two content
tools fail by name (`CONTENT_UNSUPPORTED`) rather than approximating page access.

## Known Limitations and Deferred Work

- Content reading requires a Playwright-capable host with a browser installed.
- Web embedding is subject to each site's framing policy; the external-browser
  escape hatch remains available.

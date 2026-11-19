# @greeneek/gnk-browser-use

Service Definition for the browser-use capability seam (`ctx.browser`). It owns
one replaceable runtime provider slot and one tracked navigation state per browser
profile. Agent tools and the visible right-panel browser surface share this single
authority, so an agent-driven navigation is reflected in the UI and vice versa.

The default provider records surface state only; the renderer presents it in its
existing webview/iframe. `browser_snapshot` reports tracked navigation state and
never claims to read page contents — the Web carrier is a cross-origin sandboxed
iframe and many sites refuse embedding.

## Model Experience

This package defines no tools and adds no model-visible text. It owns no tokens;
browser pages are untrusted data and are never treated as instructions.

## Known Limitations and Deferred Work

- Only the tracked URL/profile is available to agents; page DOM access requires a
  CDP-capable provider and an explicit authorisation model.

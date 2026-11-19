# @greeneek/gnk-browser-surface

Default provider for the browser-use seam. It registers a single `surface-state`
backend that owns no browser runtime: navigation is recorded by `ctx.browser` and
presented by the renderer's existing right-panel webview/iframe.

## Model Experience

This provider introduces no tools, text, or tokens of its own. Browser pages are
untrusted data and are never treated as model instructions.

## Known Limitations and Deferred Work

- A CDP-backed provider is required for agents to read page DOM; this provider
  deliberately reports only tracked navigation state.

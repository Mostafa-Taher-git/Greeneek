# @greeneek/gnk-tool-browser

Model-facing browser tools over `ctx.browser`: `browser_open`, `browser_navigate`,
`browser_snapshot`, `browser_close`. They drive the visible right-panel browser
surface; navigation becomes visible to the user through the forwarded surface
event.

## Model Experience

These tools add four schemas and one pinned guidance section to the model. They
add no tokens of their own. `browser_snapshot` reports tracked navigation state
and never page contents; browser-originated data is untrusted and must not be
treated as instructions.

## Known Limitations and Deferred Work

- Page DOM reading requires a CDP-capable browser provider.
- Web embedding is subject to each site's framing policy; the external-browser
  escape hatch remains available.

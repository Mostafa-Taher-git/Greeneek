---
description: "Service Definition for browser navigation: one runtime backend slot, per-profile tracked state, and the browser/surface event."
kind: "package-reference"
---

# @greeneek/gnk-browser-use

## Summary

`gnk-browser-use` defines the browser capability seam (`ctx.browser`). It owns one replaceable runtime provider slot and one tracked navigation state per browser profile. Agent tools and the visible right-panel browser surface share this authority, so an agent-driven navigation is reflected in the UI and the user's navigation is observable by agents. The default provider records surface state only; content reads require a provider that explicitly supports them and refuses by name otherwise.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through `gnk-tool-browser`, which registers the model-facing schemas and renders the tracked `browser/surface` state this service owns.

#### KV Cache effect

This package sends no provider request and contributes no prompt text, so it preserves an already-reusable cached prefix. A navigation changes only the tracked state reported by the consumer tool on the next request.

## Known Limitations and Deferred Work

- Only the tracked URL and profile are available to agents by default; page DOM access requires a content-capable provider and an explicit authorization model.
- The Web carrier is a cross-origin sandboxed iframe, so many sites refuse embedding and `browser_snapshot` never claims to read page contents.

### Dev Note

No invariant companion is published: the backend slot and tracked state have a single owner, so their relationship cannot diverge across independent observations.

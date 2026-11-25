---
description: "Default no-runtime provider for the browser-use seam; records navigation for the visible right-panel webview."
kind: "package-reference"
---

# @greeneek/gnk-browser-surface

## Summary

`gnk-browser-surface` registers one `surface-state` backend on `ctx.browser`. It drives no browser process: navigation is recorded by the browser service and presented in the renderer's existing right-panel webview or iframe. Registering this backend makes agent tools and the visible browser surface share one navigation authority.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through `gnk-tool-browser`, whose navigation schemas report the tracked state this provider records without touching page contents.

#### KV Cache effect

This provider sends no provider request and adds no prompt text, so it preserves an already-reusable cached prefix. Navigation state changes the result of a tool call, not the assembled prompt prefix.

## Known Limitations and Deferred Work

- A content-capable provider is required for agents to read page DOM; this backend deliberately reports only tracked navigation state.

### Dev Note

No invariant companion is published: the backend registers one value into a single-slot service and its disposer removes exactly that value.

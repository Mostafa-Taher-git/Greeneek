---
description: "Playwright-backed provider for the browser-use seam with persistent profiles and bounded real-page reads."
kind: "package-reference"
---

# @greeneek/gnk-browser-playwright

## Summary

`gnk-browser-playwright` is a content-capable backend for `ctx.browser`. It launches a local Chromium through Playwright, keeps one persistent context per profile, and exposes bounded page reading and link following to the Agent. The `default` profile uses a durable directory under `userDataRoot`; `incognito` uses a temporary directory removed on close.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through `gnk-tool-browser`, whose `browser_read` and `browser_click` tools call this provider for bounded page text that is prefixed as untrusted data.

#### KV Cache effect

This provider sends no provider request and contributes no prompt text, so it preserves an already-reusable cached prefix. Page contents arrive only as tool results and never enter the assembled system prompt.

## Known Limitations and Deferred Work

- Requires a local browser binary, either Playwright-managed Chromium or a compatible install.
- Driving JS-heavy SSO or login flows is a user action in Manual Mode, not an automated capability; no CAPTCHA, MFA, or anti-bot bypass is attempted.

### Dev Note

No companion invariant is published: profile isolation is owned by this provider's storage directories and asserted by provider-level behavior specs.

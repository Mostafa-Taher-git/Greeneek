---
description: "Browser AI provider registry with isolated manual sign-in sessions and credential-free status."
kind: "package-reference"
---

# @greeneek/gnk-browser-ai

## Summary

`gnk-browser-ai` owns `ctx.browserAI`, a registry of official web AI providers (`chatgpt`, `claude`, `gemini`) with independent manual and automation capability flags. Each provider gets an isolated browser profile id derived from its id, and a credential-free session projection for settings UI. `openManual` opens the vendor's official site in the visible browser surface; `read` applies the browser tool's untrusted-content boundary. Greeneek never collects a password or extracts a cookie or token.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through `gnk-command-browser-ai`, whose human `/browser-ai` command opens the isolated provider session; the registry itself registers no model tool or prompt text.

#### KV Cache effect

This package sends no provider request and contributes no prompt text, so it preserves an already-reusable cached prefix. Provider status and isolation affect the browser surface, not the assembled request prefix.

## Known Limitations and Deferred Work

- Automation is refused by name for every built-in provider: recorded terms permit manual sign-in only, so no subscription session is automated.
- Session state is status-only (`login-required`, `connected`, `session-expired`, `unavailable`); no cookie, token, or password is stored in Greeneek state.

### Dev Note

No invariant companion is published: provider descriptors and session records live in one registry whose profile mapping is a pure function of the provider id.

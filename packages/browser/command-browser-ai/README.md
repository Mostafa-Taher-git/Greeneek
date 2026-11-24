---
description: "Human /browser-ai command that opens an official AI provider site in its isolated browser session."
kind: "package-reference"
---

# @greeneek/gnk-command-browser-ai

## Summary

`gnk-command-browser-ai` registers the `/browser-ai` human command. With no argument it lists the registered providers and their manual/automation capabilities; with a provider id it calls `ctx.browserAI.openManual` and reports the isolated profile and session status. It never handles passwords or cookies.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through the human `/browser-ai` command, whose output stays in the command surface and never enters a model request.

#### KV Cache effect

This package sends no provider request and registers no prompt or tool schema, so it preserves an already-reusable cached prefix. Opening a provider session changes browser state only.

## Known Limitations and Deferred Work

- Only the three built-in official sites (`chatgpt`, `claude`, `gemini`) are addressable; an unknown id returns an error that lists the available ids.
- Sign-in stays a user action on the provider's own page; the command cannot accept credentials or automate a logged-in session.

### Dev Note

No companion invariant is published: the command is a thin adapter over `ctx.browserAI` and owns no durable state of its own.

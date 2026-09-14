# Agent Note: Web provider sign-in over the authorization seam

Status: implemented

## Problem

Providers that authenticate through a browser round-trip (OAuth device grants, code callbacks) had no sign-in path in Settings → Models: every provider card offered only an API-key field, while the authorization seam's login flows existed solely for terminal-driven compositions. The configurable-provider directory also rendered raw route ids (`openai`, `opencode`) instead of the catalog's display names ("OpenAI", "OpenCode Zen"), and the Kilo Gateway — an OpenAI-compatible aggregator the deployment should offer like any shipped provider — was absent from the installed catalog entirely.

## Decision

`packages/llm/llm-pi-ai/src/harness-catalog.ts` curates a first-class `kilo` provider ("Kilo Gateway", `https://api.kilo.ai/api/gateway`, `openai-completions`, 16 stable models with capacities read from the gateway's own `GET /models` listing) into the installed catalog; its auth reuses pi-ai's own `envApiKeyAuth` rather than a harness-owned copy. `directoryEntries()` labels every catalog route with its catalog name, so the Models page reads "OpenCode Zen", "OpenCode Go" (the only two opencode entries pi-ai ships), "OpenAI", "Kilo Gateway". The new `@greeneek/gnk-api-authorization-controller` exposes the seam to the browser as `list`, a stream-mode `attempt()` (notice / prompt / prompt-withdrawn / settled frames), `answer()`, and `cancel()`; `packages/client/ui-settings-models` adds a Sign in button on rows whose `llm-pi-ai/<route>` key has a listed flow, opening `SignInDialog` (method picker, notices with links/codes, text/secret/select prompts, outcome) which aborts its stream on close. Credential values never cross the namespace in either direction.

## Alternatives considered

**Forwarded waterfall events for the prompt round-trip.** Rejected: forwarded waterfalls require an Agent identity to route to a page, and an authorization prompt is host-global. The stream Remote carries the same frames without an Agent.

**A harness-owned api-key auth copy for the curated provider.** Rejected: pi-ai exports `envApiKeyAuth` with exactly the stored-credential-wins, env-resolves, login-prompts behavior; owning a copy would duplicate maintained code against the dependencies-over-hand-rolling policy.

**Sign-in inside the provider editor card instead of the row.** Rejected: sign-in replaces the key-entry step, so it belongs beside the other row actions where the credential state dot already lives; the editor stays the place for stored-key management.

**Covering the abort-reason fallback and the `?? provider` fallback with tests.** Rejected: `AbortSignal.reason` always defaults once fired and every catalog id resolves its provider while both halves read one catalog, so both fallbacks carry `v8 ignore` notes instead; the non-Error rejection path stays tested through the repo's `oxlint-disable` idiom.

## Consequences

- OAuth-capable pi-ai routes show Sign in; key-only routes are unchanged, and compositions without the authorization seam render the page exactly as before (the flows read resolves empty).
- `llm-pi-ai` (281 tests), `authorization-controller` (20 tests), and `ui-settings-models` (259 tests) stay green with typecheck, lint, and per-file coverage; the two web e2e goldens listing the provider directory gain the `kilo` option.
- Curated Kilo capacities are a snapshot: when the gateway's catalog moves, the list is corrected the same way as any route — the Models model editor or a `models` list in `settings.yaml`.

## Related

- [Models-page extension slots](../architecture/2026-08-26-models-page-extension-slots.md) moved provider sign-in toward an optional out-of-tree plugin; the `llm-pi-ai` flows nevertheless stayed registered in-product, and this dialog surfaces exactly those registered flows rather than adding a new authentication surface.

# Agent Note: Required-explicit provider endpoints, no shipped default

Status: implemented

## Problem

The harness claimed BYOK-only operation, but two provider plugins still carried a hard-coded default endpoint that no deployment operates: the chat-completions adapter (`llm-greeneek`) exported `PUBLIC_BASE_URL = 'https://api.greeneek.dev'` as the final fallback when neither `llm-greeneek.baseURL` nor `$GREENEEK_BASE_URL` was configured, and the search provider (`web-search-greeneek`) fell back to `GREENEEK_DEFAULT_BASE_URL = 'https://api.greeneek.dev/anthropic/v1'`. A "configured" route could therefore still dispatch real credentials with a key to a host that resolves nowhere, and the web Models page advertised that dead endpoint as the base-URL placeholder. GitHub issue #84.

## Decision

Both endpoint defaults are removed, and every endpoint is deployment-supplied:

- `llm-greeneek` resolves its endpoint from config then `$GREENEEK_BASE_URL` and may leave it absent. The resolution output is `GreeneekConnectionFacts` (`baseURL?` in `adapter.ts`): registration, retry-policy capture, model metadata, and request pricing work without an endpoint, so the plugin still boots, lists the route, and serves discovery. Each operation narrows the facts into a `GreeneekConnectionOptions` through the adapter-private `connection()` step before anything dispatches; the missing endpoint fails typed `MISSING_ENDPOINT` with the plugin-supplied diagnostic (`missingEndpoint`) naming `llm-greeneek.baseURL`, the web Models page, and `$GREENEEK_BASE_URL`. Without the embedder hook the adapter throws its own generic `MISSING_ENDPOINT`.
- `web-search-greeneek` resolves its endpoint from config then `$GREENEEK_SEARCH_BASE_URL` and may leave it absent. `available()` reports usable only with a configured, parseable endpoint plus a key or key resolver, so the unconfigured Custom engine never enters auto-selection; a `search()` call without an endpoint throws typed `WEB_PROVIDER_ENDPOINT_MISSING` before credential resolution or dispatch, naming `web-search-greeneek.baseURL`, the plugin-configuration page, and `$GREENEEK_SEARCH_BASE_URL`.
- The web Models page placeholder for a Greeneek-family route is the locale-owned hint `baseUrlGreeneek` ("Your Greeneek-protocol endpoint") in English and Chinese; the dead URL is gone from the client and from the `onboarding-greeneek-config` expected snapshot.
- Real-API suites no longer assume any hosted endpoint: the vision e2e requires `$GREENEEK_BASE_URL` outright, the search probe requires `$GREENEEK_SEARCH_BASE_URL`, and the Codex/Claude Code subagent bridges accept any `$GREENEEK_BASE_URL` the deployment operates instead of refusing a non-official domain.

The shipped composition keeps the dead plugin unselected: the base bundle's default search provider stays the keyless DuckDuckGo row, and `web-search-greeneek` stays mounted as the explicitly configured Custom engine. The chat adapter stays unmounted in the base bundle.

## Alternatives considered

**Keep the constant and let deployments disable it.** Rejected: a default name that no deployment operates is either a misconfiguration mine (credentials sent to a dead host) or requires each deployment to add a config line just to correct shipped defaults; the eager `available()`/MISSING check plus the required field does the same job honestly.

**Fail at plugin load instead of request time.** Rejected: the same resolution runs live with settings snapshots, and an endpoint may arrive seconds after boot; the resolver contract otherwise keeps the last good facts, so boot behavior would depend on configuration race order. Request-time failure matches the existing `MISSING_CREDENTIAL` pattern.

**Drop the two plugins from the bundles entirely.** Rejected: the search provider is the only Anthropic-compatible Messages search backend, and the chat adapter is the deployment-mounted route for a Greeneek-protocol gateway; they work exactly as documented once an operator names their own endpoint.

## Consequences

A fresh install can never silently send a key to `api.greeneek.dev`: with no endpoint configured, chat requests finish as `MISSING_ENDPOINT` errors and search reports the provider unavailable or fails typed pre-dispatch. Operators configure endpoints through the same two fields as before (`baseURL` config, or the respective `$GREENEEK_BASE_URL` / `$GREENEEK_SEARCH_BASE_URL` environment keys), so no existing honest configuration changes behavior. The facts-then-connection split in the adapter makes the endpoint the only operation-gating fact, mirroring per-request credential resolution. The scoped package suites cover the boot-metadata-works-without-endpoint path, the typed failure with its remedy text, availability gating, and the placeholder snapshot; the real-API lanes are skippable without keys and loud when keys exist but endpoints do not.

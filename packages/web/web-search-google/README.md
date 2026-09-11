---
description: "The Google-backed search provider for ctx.web: how deployments mount vendor-native web search through Programmable Search with portable snippets."
kind: "package-reference"
---

# @greeneek/gnk-web-search-google


## Summary

With `gnk-web-search-google`, the harness searches the web through Google's Programmable Search JSON API and gets vendor-native results with portable snippets. Choose it when a deployment has a Google API key plus a Programmable Search engine id (cx) and wants Google results. Google returns no generated answer, so results carry no `content` — only citeable sources. A result with a blank link is dropped, so a call can return fewer sources than requested. The model-facing `web_search` tool lives in `gnk-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `google` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: google`. In Settings → General, the search-engine row offers it as Google alongside DuckDuckGo and Custom.

### When to choose it

Choose this backend when a deployment holds a Google API key and a Programmable Search engine id and wants Google results with per-result snippets. The provider is unavailable — and every search call fails with a structured error — when the key or the engine id is empty or the endpoint base does not parse. Create both in the Google Cloud console (Custom Search API key) and Programmable Search Engine control panel (engine id / cx).

### Minimal configuration

Load the web service and the provider; the key and engine id fall back to `$GOOGLE_SEARCH_API_KEY` / `$GOOGLE_SEARCH_ENGINE_ID` from the launch environment, and all other settings have safe defaults.

```yaml
- name: '@greeneek/gnk-web'
- name: '@greeneek/gnk-web-search-google'
  config:
    apiKey: process.env.GOOGLE_SEARCH_API_KEY
    searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$GOOGLE_SEARCH_API_KEY` | Google API key; empty or absent makes the provider unavailable |
| `searchEngineId` | `$GOOGLE_SEARCH_ENGINE_ID` | Programmable Search engine id (cx); empty or absent makes the provider unavailable |
| `baseURL` | `https://www.googleapis.com` | Endpoint base; `/customsearch/v1` is appended. An unparseable value makes the provider unavailable |
| `numResults` | (unset) | Default result count when a request carries no `maxResults`; must be a positive integer |

The generated [configuration catalog](../../../docs/config-catalog.md#greeneekgnk-web-search-google) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each Google item maps to a `WebSearchSource`: `link` as `url`, plus `title` and `snippet` when non-blank; an item with a blank link has no portable URL and is dropped. A request's `maxResults` wins over the configured `numResults` default and is clamped to Google's per-request maximum of 10 before sending — the final bound is enforced by the service, which truncates and flags. Google returns no generated answer, so the result carries no `content`.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over Google's API with two deliberate rules:

- **Portable URLs only.** A source gains a `url` only from a real non-blank link; inventing one from other fields would make the seam lie, so link-less items are dropped entirely.
- **No invented answers.** Google returns no generated answer, so `content` is omitted rather than fabricating provider prose the model might trust.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, environment fallback, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `GoogleSearchProvider`: request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | Google wire types: `GoogleSearchResponse`, `GoogleResult`, `GoogleError` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`search()` gets the query, key, engine id, and optional clamped result count from `{baseURL}/customsearch/v1` with `redirect: 'error'`, so a redirect fails the request without contacting the target. The parsed `items[]` are mapped one by one, blank-link entries dropped, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the family and each role.
- [gnk-web](../web/README.md) — the web service this provider registers into.
- [gnk-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#greeneekgnk-web-search-google) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `gnk-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, and snippets or its exact `Google search aborted`, `Google search request failed: <error>`, and `Google returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **Google's per-request `num` caps at 10** — a larger `maxResults` still truncates correctly on the way back, but the provider fetches at most 10 per call and never pages.
- **An item with a blank link is dropped entirely** — there is no portable URL to map, so fewer sources than requested can return.
- **Only `numResults` is exposed** — Google's other controls (date restriction, exact terms, site search, safe search) wait on provider-neutral service fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `gnk-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: wider Google control surface

Date restriction, exact terms, site search, and safe search stay unexposed. Exposing them needs provider-neutral service fields first, so the family adds one coordinated control rather than a vendor-specific argument.

</details>

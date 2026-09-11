---
description: "The DuckDuckGo-backed search provider for ctx.web: keyless web search through Instant Answer with portable sources."
kind: "package-reference"
---

# @greeneek/gnk-web-search-duckduckgo


## Summary

With `gnk-web-search-duckduckgo`, the harness searches the web through DuckDuckGo's Instant Answer API — no key, no account, usable out of the box. Choose it when a deployment wants search with zero configuration. The abstract maps to the first source, related-topic blurbs to further sources, and a non-blank instant answer (calculations, conversions) to `content`. Entries with a blank URL are dropped. The model-facing `web_search` tool lives in `gnk-tool-web`.

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

Mount the provider in a composition that already loads the web service; it registers as the `duckduckgo` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: duckduckgo`. In Settings → General, the search-engine row offers it as DuckDuckGo alongside Google and Custom. Because it needs no key, a deployment with no search keys at all still searches: this provider auto-selects and `web_search` works.

### When to choose it

Choose this backend when a deployment wants search without credentials — local runs, first boot, keyless tiers. Instant Answer shines for entities, facts, calculations, and conversions; it is thinner than Google/Exa for broad exploratory queries, so prefer a keyed provider when recall matters more than zero setup.

### Minimal configuration

Load the web service and the provider; there is nothing to configure.

```yaml
- name: '@greeneek/gnk-web'
- name: '@greeneek/gnk-web-search-duckduckgo'
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.duckduckgo.com` | Endpoint base; `/` is queried. An unparseable value makes the provider unavailable |

The generated [configuration catalog](../../../docs/config-catalog.md#greeneekgnk-web-search-duckduckgo) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

The abstract (when it names a source URL) maps to the first `WebSearchSource` with the source name as `title` and the abstract text as `snippet`; each related-topic blurb maps to a source with the blurb as `snippet`, preserving wire order with nested group topics after their group entry. A request's `maxResults` is enforced by the service, which truncates and flags — the API takes no count parameter. A non-blank instant `Answer` maps to `content` (the provider's own answer text, not an invention).

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. An HTTP error body, when present, is appended to the status-line message (first 200 chars). Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over the Instant Answer API with two deliberate rules:

- **Portable URLs only.** A source gains a `url` only from a real non-blank link; inventing one from other fields would make the seam lie, so link-less entries are dropped entirely.
- **Provider answers only.** `content` carries only DuckDuckGo's own instant `Answer`, never text assembled from blurbs the model might mistake for a direct answer.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `DuckDuckGoSearchProvider`: request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | DuckDuckGo wire types: `DuckDuckGoSearchResponse`, `DuckDuckGoTopic` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`search()` gets `{baseURL}/?q=&format=json&no_html=1&skip_disambig=1` with `redirect: 'error'`, so a redirect fails the request without contacting the target. The envelope is shape-checked (non-object envelopes and non-array topic lists fail as provider errors, never raw TypeErrors), mapped in wire order, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the family and each role.
- [gnk-web](../web/README.md) — the web service this provider registers into.
- [gnk-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#greeneekgnk-web-search-duckduckgo) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `gnk-tool-web`, which retains this provider's `maxResults`-bounded abstract, topic sources, and instant answer or its exact `DuckDuckGo search aborted`, `DuckDuckGo search request failed: <error>`, and `DuckDuckGo returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **Instant Answer is thinner than keyed search** — strong for entities, facts, and calculations; broad exploratory queries return fewer, shorter sources than Google/Exa/Perplexity.
- **No result-count control** — the API takes no count parameter; the seam truncates to `maxResults` but the provider always fetches the API's fixed set.
- **An entry with a blank URL is dropped entirely** — there is no portable URL to map, so fewer sources than requested can return.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `gnk-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: richer keyless retrieval

If a deployment needs broad keyless recall, a follow-up provider over DuckDuckGo's HTML endpoint (with its scraping fragility and terms-of-service cost stated) or a second keyless source stays a separate package — this one stays on the stable Instant Answer API.

</details>

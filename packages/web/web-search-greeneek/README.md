---
description: "A Greeneek-protocol search provider for ctx.web: how deployments mount native-style web search through an Anthropic-compatible Messages API endpoint they operate, with per-search credential resolution."
kind: "package-reference"
---

# @greeneek/gnk-web-search-greeneek


## Summary

With `gnk-web-search-greeneek`, the harness searches the web through a Greeneek-protocol endpoint the deployment operates, using its own `GREENEEK_API_KEY`. Choose it when a deployment operates such an endpoint and accepts that one search costs a full model turn in latency and tokens, because the protocol exposes no dedicated search endpoint. The harness ships no hosted search endpoint (BYOK-only). Results come from the structured search blocks the endpoint returns, never from scraping text out of a reply. A missing credential fails the call with a structured error; a response without a search-result block fails loudly rather than degrading. The model-facing `web_search` tool lives in `gnk-tool-web`.

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

Mount the provider in a composition that already loads the web service; it registers as the `greeneek-official` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: greeneek-official`.

### When to choose it

Choose this backend when a deployment operates a Greeneek-protocol search endpoint and already holds a `GREENEEK_API_KEY` for it — the provider reuses that credential reference. One search is heavier than a dedicated retrieval endpoint: the endpoint runs the search inside a full model turn, so expect one Messages call's latency and generated tokens per search, with up to `maxUses` server-side searches per request. Avoid it when per-search cost or latency dominates.

### Minimal configuration

Load the web service and the provider; the key resolves from `ctx.credentials` when that service is mounted, otherwise from the process environment. Configure the Anthropic-compatible base explicitly — the built-in default names a host this repository does not operate, so always override it. It is distinct from the chat-completions base the LLM adapter uses — never reuse `$GREENEEK_BASE_URL`.

```yaml
- name: '@greeneek/gnk-web'
- name: '@greeneek/gnk-web-search-greeneek'
  config:
    apiKeyEnv: GREENEEK_API_KEY
    baseURL: https://gateway.internal/anthropic/v1
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Greeneek API key; prefer `apiKeyEnv` so no secret enters configuration. A non-empty literal wins |
| `apiKeyEnv` | `GREENEEK_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the process environment when that service is absent. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING` |
| `baseURL` | placeholder only | Anthropic-compatible endpoint base; `/messages` is appended. Falls back to `$GREENEEK_SEARCH_BASE_URL`; the built-in default names a host this repository does not operate — always configure a reachable endpoint. An unparseable value makes the provider unavailable |
| `model` | `greeneek-v4-flash` | Anthropic-format model name |
| `apiVersion` | `2023-06-01` | `anthropic-version` header value |
| `maxTokens` | `4096` | Positive-integer upper bound on generated tokens for the Messages request |
| `maxUses` | `5` | Positive-integer maximum `web_search` server-tool uses per request |

The generated [configuration catalog](../../../docs/config-catalog.md#greeneekgnk-web-search-greeneek) is the exhaustive source for every accepted field and its JSDoc. The entry above is the base layer of the provider's Settings section; a user layer over it reaches the next search, because the provider projects the section per call rather than capturing it at registration.

### What a search returns

`content` is always omitted: Greeneek's provider prose is not trusted as an answer. `sources[]` comes from `web_search_result` items inside `web_search_tool_result` blocks — `url`, `title`, and `publishedAt` from `page_age` — with snippets joined from URL-keyed `cited_text` entries where an excerpt exists. Results are deduplicated by URL, and because Greeneek exposes no result-count knob, the service enforces `maxResults` by truncating and flagging.

### Request logging

A search running under an initiating agent appends the log-only `web/greeneek-search-llm-request` session event immediately before dispatch. It carries the resolved endpoint, API version, and the exact secret-free JSON body sent to Greeneek; headers and credentials are excluded. Credential failures and cancellations before dispatch create no event, while later HTTP or response failures leave the attempted request durable.

### Failures and recovery

Failures throw `WebError` with a machine-routable code: a missing credential is `WEB_PROVIDER_CREDENTIAL_MISSING`, caller cancellation is `WEB_ABORTED`, and provider or transport failures — including a response with no `web_search_tool_result` block — are `WEB_PROVIDER_ERROR`. HTTP redirects are rejected before the `Location` target is contacted. Every failure after dispatch names the resolved search endpoint and explains that search endpoint configuration is separate from chat. If the endpoint is unintended, the message tells the conversation model to guide the user to the Endpoint field under Settings > Plugins > Plugin configuration > Web search and save the change. When that page is unavailable, it names `GREENEEK_SEARCH_BASE_URL` and `web-search-greeneek.baseURL` as deployment configuration alternatives. The model must not choose or change the endpoint. The model-facing `web_search` tool surfaces this text under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is built on two commitments:

- **Structured blocks only.** Greeneek runs the search server-side and returns structured `web_search_tool_result` blocks; the provider parses those blocks and never scrapes URLs out of model prose. In strict mode, a response with no such block throws `WEB_PROVIDER_ERROR` instead of degrading.
- **One credential, resolved per search.** The provider reuses the `GREENEEK_API_KEY` reference (no new secret) but not `$GREENEEK_BASE_URL`, because search speaks the Anthropic-compatible Messages API. A mounted credentials service is authoritative; without one the provider falls back to the launching process environment. Resolving per call means a key stored or rotated in the Web Models page reaches the next search without a restart.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, Settings section installation, per-search option projection |
| [`src/provider.ts`](src/provider.ts) | The `GreeneekSearchProvider`: Messages request dispatch, block parsing, citation joining, credential resolution |
| [`src/types.ts`](src/types.ts) | Anthropic wire types for the search response |
| — | No runtime invariant companion is published; the package emits a pre-dispatch log event but owns no later authoritative dispatch event to relate it to. Exact envelope equality is pinned at the provider boundary instead. |

### Request flow

Each search projects the current Settings section into provider options — endpoint, model, key reference, limits — then resolves the credential reference through `ctx.credentials` (or the environment), appends the log-only session event, and dispatches the Messages request with the native `web_search` server tool. The response's `web_search_tool_result` blocks become `sources[]`; `cited_text` entries from text blocks are joined to their URLs as snippets; results are deduplicated by URL; and the service enforces the requested source bound on the way back.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the six-package family and each role.
- [gnk-web](../web/README.md) — the web service this provider registers into.
- [gnk-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#greeneekgnk-web-search-greeneek) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

### Auxiliary Greeneek search request

#### What the model sees

A separate Greeneek model receives exactly `Perform a web search for the query: <query>` as its user text and one native `web_search` server-tool definition. This request is not part of the conversation model's context.

#### Token effect

Separate provider input and output tokens are incurred for each search; `maxTokens` caps generated output and `maxUses` caps native search uses.

#### KV Cache effect

Independent of the conversation request cache. The auxiliary instruction and native tool definition can form a stable prefix, but each changed query or model route prevents reuse from its first difference.

### Conversation tool result, indirectly

#### What the model sees

Through `gnk-tool-web`, the conversation model sees deduplicated URLs, titles, dates, and citation snippets from structured search blocks; provider prose is not trusted as an answer. This provider's exact failures include the actionable missing-credential message, `Greeneek search credential resolution failed: <error>`, and `Greeneek search aborted`. Request, HTTP, native-search, and response-body failures append the resolved endpoint and the conditional configuration instruction described above. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration. Result tokens scale with returned sources and snippets, then the service enforces the requested source bound.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is expensive or incomplete. They are current package constraints.

- **One search costs a full Messages model turn** — latency plus generated tokens, with up to `maxUses` server-side searches; Greeneek exposes no dedicated retrieval endpoint.
- **Dynamic credential availability resolves inside the operation** — the synchronous availability check can establish that a resolver exists but cannot query an asynchronous credential store, so a selected keyless provider fails the search with `WEB_PROVIDER_CREDENTIAL_MISSING`; the stable `web_search` schema stays registered.
- **Over-returned sources still cost tokens** — with no result-count knob on the wire, `maxResults` is enforced only post-hoc by service truncation.
- **Uncited results carry no `snippet`** — a source gains one only when a text-block citation (`cited_text`) matches its URL.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: dedicated retrieval endpoint

A native Greeneek search endpoint that avoids the full model turn would remove the dominant cost; until Greeneek exposes one, this provider stays a Messages-call adapter.

</details>

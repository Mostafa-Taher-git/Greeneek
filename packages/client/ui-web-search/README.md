---
description: "Search-engine preference row for the gnk web client: engine choice plus custom endpoint in Settings General."
kind: "package-reference"
---

# @greeneek/gnk-client-ui-web-search


## Summary

`gnk-client-ui-web-search` is the search-engine preference row in Settings → General: users pick Auto, DuckDuckGo, Google, Exa, Perplexity, or Custom, and while Custom is active they save an Anthropic-compatible endpoint base plus model. The choice writes the `web` settings section (`searchProvider`), which the web service resolves live with no restart; the custom facts write the `web-search-greeneek` section (`baseURL`, `model`). Keys stay out of the UI: keyed engines read theirs from the launch environment. DuckDuckGo needs no key, so search works out of the box.

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

Mount the plugin in a composition that loads the settings General section; it registers the `search-engine` row into `settings.general.item` and writes through the two Host settings scopes. No configuration: the engine list is fixed and the scopes bind by namespace.

### Engine choice

Auto clears the pin and the service auto-selects the only usable provider. A pinned engine must be registered and usable or every `web_search` call fails with the seam's structured selection error (`WEB_PROVIDER_CONFIGURED_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`), which names the missing piece. An unknown engine id fails loud on write rather than persisting a dead pin.

### Custom endpoint

Custom selects the Greeneek search provider, which speaks the Anthropic Messages API with server-side search: any compatible endpoint works. Endpoint and model save together; clearing a field removes it from the section (falling back to env/defaults) rather than storing an empty string. The key comes from `$GREENEEK_API_KEY` in the launch environment, never from the row.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The row mirrors two Host scopes into one store: the `web` section's `searchProvider` plus the `web-search-greeneek` section's `baseURL`/`model`, with a local revision counter sealing the init window. Writes go straight through the scopes (`set`/`unset`); the store updates on the scope echo, so no optimistic state can strand the row ahead of the document.

### Slot discipline

Declaration-aware `slots.inject()` lets the package activate before or after the General section. The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SearchEngineRow, the store factory, and the settings vocabulary remain package-internal behind the slot registration (tests import them relatively).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces this row writes and the composition model.

- [gnk-web](../../web/web/README.md) — the service resolving the pinned engine live.
- [gnk-web-search-duckduckgo](../../web/web-search-duckduckgo/README.md) — the keyless backend behind the default choice.
- [gnk-web-search-google](../../web/web-search-google/README.md) — the Google backend and its key setup.
- [gnk-web-search-greeneek](../../web/web-search-greeneek/README.md) — the Custom vehicle and its endpoint contract.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the row owns versus what the Host owns; they are current package constraints.

- **Keys stay in the launch environment** — the row offers no key inputs; a pinned keyed engine without its key fails with the seam's unavailable error, not with row-level guidance.
- **Endpoint changes apply on provider (re)load** — the engine pin resolves live, but a saved endpoint/model is read when the provider plugin applies, so a running deployment picks it up on reload.
- **No per-engine availability display** — the row lists every offered engine without marking which are usable; availability stays the seam's runtime judgment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A pure-consumer plugin mirroring two settings scopes into one row store — it emits no cordis events and owns no cross-plugin mutable state; mirroring and write-through behavior are asserted directly by this package's apply/row/store specs.

# Agent Note: Open egress, user-chosen search engines, keyless search that works

Status: implemented

## Problem

Three user reports shared one root: the harness blocked provider choice
and search never worked out of the box. The egress policy hard-refused
every retired-provider host whatever the configuration said; Settings had
no search-engine choice; and the base profile mounted only Exa and
Perplexity — both unavailable without keys — so `web_search` failed on
every fresh deployment with no usable provider.

## Decision

Open egress by default and put the operator in charge of endpoints. The
retired-provider blocklist is empty (the export stays as the single
deployment override point, proven by a test that lists a host and sees
it refuse); strict mode stays opt-in and unchanged. Consumer comments, the package
README, and the spec now state the open contract. The fetch seam's SSRF
guard (non-public IPs, credentials in URLs, redirect caps) stays: it
blocks attack surface, not providers.

Search engines are a user choice in Settings → General, backed by two
new provider packages. Google speaks the official Programmable Search
JSON API (key + cx, `num` clamped to the API's 10). DuckDuckGo speaks
the keyless Instant Answer API (abstract → first source, blurbs →
sources, instant answer → content), so an unkeyed deployment searches
immediately. Custom reuses the Greeneek provider's own endpoint/model
fields against any Anthropic-compatible Messages endpoint; keys stay in
the launch environment, never in the row.

The `web` service resolves the saved pin live: it installs its own
`web` settings section and reads the current source at execution time,
so switching engines applies with no restart. Endpoint/model edits
apply on provider (re)load like every other provider's config. All five
search providers mount in the base bundle; auto-select semantics are
unchanged (exactly one usable wins, several usable without a pin is
still `WEB_PROVIDER_AMBIGUOUS`).

Kilo Gateway is configuration, not code: a custom-route recipe
(openai-completions, `https://api.kilo.ai/api/gateway`, `KILO_API_KEY`)
in the providers user guide. Effort work is deferred per the
clarification round (no answer; recommendations adopted).

## Alternatives considered

**Scraping DuckDuckGo HTML for richer results.** Rejected: fragile and
against their terms; the row README names it as a possible separate
package so this one stays on the stable Instant Answer API.

**A new custom-search wire protocol.** Rejected: no standard exists, so
a "custom endpoint" speaking an invented shape would be unusable. The
Greeneek provider already accepts endpoint/model/key — Custom points at
it, which is real today.

**A built-in Kilo catalog route.** Rejected: catalog routes come from
the installed pi-ai catalog, which ships no Kilo provider; the custom
route reaches the same implementation with no code.

## Consequences

Fresh deployments search with zero configuration (DuckDuckGo
auto-selects); a single keyed engine keeps working untouched;
multi-keyed deployments name the winner in Settings or via
`GNK_WEB_SEARCH_PROVIDER`. The egress spec asserts reachability of the
previously blocked hosts, so any future re-block is a deliberate,
reviewed change. New packages follow the family gates: per-file 100%
coverage, oxlint clean, config-catalog regenerated, README limitations
and model-experience entries audited.

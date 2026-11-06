# Agent Note: the DuckDuckGo fallback reports cancellation as cancellation

Status: implemented

## Problem

`DuckDuckGoSearchProvider.wikipediaSources` runs behind an Instant Answer that answered with nothing. Its one `catch` resolved every thrown value to an empty source list, so a search whose surrounding `AbortSignal` fired during the fallback returned `{ sources: [], truncated: false }`. The tool layer then rendered the empty-result sentence from `formatSearchOutput`, and a cancelled search reached the model as a completed search with no findings — the failure the web seam's cancellation contract exists to prevent, and the reason `search()` rethrows `WEB_ABORTED` on its own primary request path.

## Decision

The fallback keeps its best-effort rule for provider failures and gives cancellation the seam's rule. After an empty Instant Answer, a rejected request, a non-OK response, or an unparseable body still resolves to no sources, because the primary backend already answered and enrichment cannot revoke it. When the surrounding signal is aborted, or the thrown value is an abort error, `wikipediaSources` rethrows `WebError('DuckDuckGo search aborted', 'WEB_ABORTED')` with the original error as its cause, so `WebRuntime.search`, the `web_search` tool, and the caller's cancellation see one outcome.

## Alternatives considered

**Report every fallback failure as `WEB_PROVIDER_ERROR`.** Rejected: it would turn a search whose primary endpoint answered into a failed tool call whenever the optional enrichment host is down, and the empty-answer case is a legitimate result.

**Check `signal.aborted` after the fallback instead of inside its catch.** Rejected: the abort and the swallow would remain two owners of one outcome, and a signal that fires between the fetch rejection and the check still yields the empty result the check was meant to replace.

**Return the sources collected so far with a cancellation flag.** Rejected: `WebSearchResult` has no such field, and inventing one to express a state the seam already reports through `WEB_ABORTED` widens the contract for no consumer.

## Consequences

A cancelled search now fails through the same typed error as a cancellation during the primary request, and the empty-result sentence reaches the model only for searches that actually ran to completion. The package's `search` suites pin both sides: the three fallback failure forms still resolve empty, and an abort raised inside the fallback rejects with `WEB_ABORTED`.

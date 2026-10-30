# Agent Note: Dashboard spend is reported only from a sourced, effective-dated price catalog

Status: implemented

## Problem

The Dashboard reported session, workspace, turn, step, and output-token totals and stated that input tokens and cost "are not recorded". Two of those statements had become wrong in opposite directions. The host already delivers `tokenUsage` (uncached input, output, cache read, cache write) and `agentPreset` as client-visible session projections, so real recorded input tokens were being hidden; and spend was described as unrecorded rather than as unpriced, which reads as "this deployment cannot know" when the true reason is "no price has been sourced". A zero or scraped number would be worse than either, but silence loses the distinction the owner asked for.

## Decision

The Dashboard folds the projections it already receives and prices them through one versioned catalog in `packages/client/ui-workspace/src/client/dashboard-pricing.ts`.

- **The shipped catalog is empty, deliberately.** `SHIPPED_PRICING_CATALOG` carries `version: '0'` and no entries. An entry requires `provider`, `model`, `currency`, per-million input and output rates, a `source`, and an `effectiveFrom` date, so no price can enter without its evidence. Spend therefore renders as unknown today, with the reason `no-catalog-entry`.
- **A price must already have been effective when the observation happened.** `resolvePrice` rejects an entry whose `effectiveFrom` falls after the row's `updatedAt`, and picks the newest effective entry when several apply, so a later price change cannot rewrite what an older session cost.
- **A total exists only when every route is priced in one currency.** `totalCost` returns `mixed-currency` for differing currencies and `no-catalog-entry` when any route is unpriced: a partial sum would read as the complete spend while silently omitting work that did happen.
- **Unmeasured rows never contribute zeroes.** A session row with no `projectionValues` is `recorded: false`; the fold excludes it from every token and turn total, reports `dataState: 'partial'` with its count, and renders `Not recorded` in its table cells instead of `0`. `'empty'` is a distinct state with its own copy, so an untouched install is not shown as a wall of zeroes.
- **The page takes an optional catalog.** `DashboardPageInjected.pricing` lets a deployment override prices; the slot registration omits it, so the shipped empty catalog applies. The cost card states the reason beside the unknown value rather than only a dash.

## Alternatives considered

**Fold cost in the host behind a new `dashboard-controller` package.** Rejected for this release: the host already sends the authoritative `tokenUsage` and `agentPreset` projections per session row, so a second host aggregation would create a second home for the same fact and let the two disagree. The consolidation starts at the seam that already owns the values.

**Ship a price table filled from provider pricing pages.** Rejected: the plan forbids invented pricing, and an unversioned table silently drifts when a provider changes a rate. The catalog type exists so a verified table can land as one reviewed change with its `source` and `effectiveFrom`.

**Report zero when a route is unpriced.** Rejected: a zero is a claim about spend. Unknown with a stated reason is the honest reading, and the reason distinguishes "no price sourced" from "no tokens recorded" and from "currencies differ".

## Verification

- `packages/client/ui-workspace/tests/dashboard-pricing.client.spec.ts` covers route matching, effectiveness windows, newest-effective selection, unparseable dates, cache-read pricing with and without a published rate, unpriced cache writes, rounding, and each refusal reason.
- `packages/client/ui-workspace/tests/dashboard-model.client.spec.ts` covers the fold: breakdowns, archived exclusion, deterministic tiebreaks, partial and empty states, priced and unpriced routes, effectiveness rejection, and mixed currencies.
- `packages/client/ui-workspace/tests/dashboard.client.spec.tsx` renders priced spend with its catalog version, each unknown reason, the unmeasured row, the blank-row filter, and the workspace-name fallback.
- `pnpm exec vitest run packages/client/ui-workspace` passes 188 tests; the three dashboard sources measure 100% statements, branches, functions, and lines.

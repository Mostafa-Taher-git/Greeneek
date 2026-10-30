/**
 * Versioned local pricing catalog and the one cost rule the Dashboard applies.
 *
 * A cost is reported only when a sourced price covers the exact provider/model
 * route and was effective at the time the session was last updated. Everything
 * else is unknown: reporting zero, or a price scraped from a page nobody
 * versioned, would be a false statement about what the user spent.
 * @module @greeneek/gnk-client-ui-workspace/dashboard-pricing
 */

/** Token buckets a price is computed over. */
export interface DashboardTokenBuckets {
  /** Prompt tokens billed at the full input rate. */
  readonly inputTokens: number
  /** Completion tokens, reasoning included by the provider's own accounting. */
  readonly outputTokens: number
  /** Cache-read tokens, priced separately when the provider publishes a rate. */
  readonly cacheReadTokens: number
  /** Cache-write tokens; no shipped provider publishes a distinct rate, so they are unpriced. */
  readonly cacheWriteTokens: number
}

/** One route's published price, carrying the evidence that makes it usable. */
export interface DashboardPriceEntry {
  /** Provider identifier as recorded on the request. */
  readonly provider: string
  /** Model identifier as recorded on the request. */
  readonly model: string
  /** ISO 4217 currency code the amounts are denominated in. */
  readonly currency: string
  /** Whole currency units charged per one million input tokens. */
  readonly inputPerMillion: number
  /** Whole currency units charged per one million output tokens. */
  readonly outputPerMillion: number
  /** Whole currency units per one million cache-read tokens; omitted when not published. */
  readonly cacheReadPerMillion?: number
  /** Where the number came from; an unsourced price cannot enter the catalog. */
  readonly source: string
  /** ISO `YYYY-MM-DD` date the price took effect. */
  readonly effectiveFrom: string
}

/** One catalog revision; `version` is stored beside every cost it produces. */
export interface DashboardPricingCatalog {
  readonly version: string
  readonly entries: readonly DashboardPriceEntry[]
}

/** Why a cost could not be priced. */
export type DashboardCostUnknownReason =
  | 'no-catalog-entry'
  | 'no-recorded-usage'
  | 'mixed-currency'

/** Priced usage, rounded to six decimal places so totals stay reproducible. */
export interface DashboardKnownCost {
  readonly kind: 'known'
  readonly currency: string
  readonly amount: number
  /** Catalog revision the amount was computed from. */
  readonly catalogVersion: string
}

/** Unpriced usage with the state the Dashboard must show instead of a number. */
export interface DashboardUnknownCost {
  readonly kind: 'unknown'
  readonly reason: DashboardCostUnknownReason
}

/** Cost result for one route or for the whole catalog. */
export type DashboardCost = DashboardKnownCost | DashboardUnknownCost

/**
 * The shipped catalog is empty on purpose: this repository holds no versioned,
 * sourced price list, and inventing entries would make every total a
 * fabrication. Adding a sourced entry here is the only way spend becomes
 * visible, which keeps the claim and its evidence in one place.
 */
export const SHIPPED_PRICING_CATALOG: DashboardPricingCatalog = { version: '0', entries: [] }

/**
 * Find the price that applies to a route at a point in time.
 * @param catalog - the catalog revision to search.
 * @param provider - provider identifier recorded on the request.
 * @param model - model identifier recorded on the request.
 * @param at - epoch milliseconds the price must already have been effective at.
 * @returns the newest entry effective at `at`, or `undefined` when none applies.
 */
export function resolvePrice(
  catalog: DashboardPricingCatalog,
  provider: string,
  model: string,
  at: number,
): DashboardPriceEntry | undefined {
  let selected: DashboardPriceEntry | undefined
  for (const entry of catalog.entries) {
    if (entry.provider !== provider || entry.model !== model) continue
    const effective = Date.parse(`${entry.effectiveFrom}T00:00:00Z`)
    // A price that took effect after the observation cannot describe it.
    if (!Number.isFinite(effective) || effective > at) continue
    if (selected === undefined || effective >= Date.parse(`${selected.effectiveFrom}T00:00:00Z`)) {
      selected = entry
    }
  }
  return selected
}

/**
 * Price one route's token buckets.
 * @param catalog - the catalog revision to price against.
 * @param usage - the route's aggregated buckets.
 * @param route - provider and model the buckets belong to.
 * @param at - epoch milliseconds the price must already have been effective at.
 * @returns the amount with its currency and catalog version, or why it is unknown.
 */
export function priceUsage(
  catalog: DashboardPricingCatalog,
  usage: DashboardTokenBuckets,
  route: { readonly provider: string; readonly model: string },
  at: number,
): DashboardCost {
  const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  if (totalTokens === 0) return { kind: 'unknown', reason: 'no-recorded-usage' }
  const entry = resolvePrice(catalog, route.provider, route.model, at)
  if (entry === undefined) return { kind: 'unknown', reason: 'no-catalog-entry' }
  const amount = (usage.inputTokens * entry.inputPerMillion
    + usage.outputTokens * entry.outputPerMillion
    + usage.cacheReadTokens * (entry.cacheReadPerMillion ?? 0)) / 1_000_000
  return {
    kind: 'known',
    currency: entry.currency,
    amount: Math.round(amount * 1_000_000) / 1_000_000,
    catalogVersion: catalog.version,
  }
}

/**
 * Combine per-route costs into one figure.
 * @param costs - every route's cost in route order.
 * @returns the summed amount when all routes are priced in one currency, or why it is unknown.
 */
export function totalCost(costs: readonly DashboardCost[]): DashboardCost {
  let currency = ''
  let catalogVersion = ''
  let amount = 0
  let priced = false
  let unpriced = false
  for (const cost of costs) {
    if (cost.kind === 'unknown') {
      unpriced = true
      continue
    }
    if (!priced) {
      currency = cost.currency
      catalogVersion = cost.catalogVersion
      priced = true
    } else if (currency !== cost.currency) {
      return { kind: 'unknown', reason: 'mixed-currency' }
    }
    amount += cost.amount
  }
  if (!priced) {
    const reason = costs.find(cost => cost.kind === 'unknown')?.reason ?? 'no-recorded-usage'
    return { kind: 'unknown', reason }
  }
  // A route with no price leaves the total unpriced: a partial sum would read
  // as the complete spend while silently omitting work that did happen.
  if (unpriced) return { kind: 'unknown', reason: 'no-catalog-entry' }
  return {
    kind: 'known',
    currency,
    amount: Math.round(amount * 1_000_000) / 1_000_000,
    catalogVersion,
  }
}

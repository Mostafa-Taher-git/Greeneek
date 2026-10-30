// Pricing rule: a cost exists only for a sourced entry that was already
// effective when the session was observed, and a total exists only when every
// route is priced in one currency.

import { describe, expect, it } from 'vitest'
import {
  priceUsage,
  resolvePrice,
  SHIPPED_PRICING_CATALOG,
  totalCost,
  type DashboardPriceEntry,
  type DashboardPricingCatalog,
} from '../src/client/dashboard-pricing.ts'

const entry = (overrides: Partial<DashboardPriceEntry> = {}): DashboardPriceEntry => ({
  provider: 'p',
  model: 'm',
  currency: 'USD',
  inputPerMillion: 3,
  outputPerMillion: 15,
  source: 'fixture rate card',
  effectiveFrom: '2026-01-01',
  ...overrides,
})

const catalog = (...entries: DashboardPriceEntry[]): DashboardPricingCatalog => ({ version: '2', entries })

describe('resolvePrice', () => {
  it('returns the entry effective at the observation', () => {
    expect(resolvePrice(catalog(entry()), 'p', 'm', Date.parse('2026-02-01'))?.inputPerMillion).toBe(3)
  })

  it('ignores a route, provider, or model that does not match', () => {
    const subject = catalog(entry())
    expect(resolvePrice(subject, 'other', 'm', Date.parse('2026-02-01'))).toBeUndefined()
    expect(resolvePrice(subject, 'p', 'other', Date.parse('2026-02-01'))).toBeUndefined()
  })

  it('refuses a price that took effect after the observation', () => {
    expect(resolvePrice(catalog(entry()), 'p', 'm', Date.parse('2025-12-31'))).toBeUndefined()
  })

  it('prefers the newest effective entry when several apply', () => {
    const subject = catalog(entry(), entry({ effectiveFrom: '2026-03-01', inputPerMillion: 4 }))
    expect(resolvePrice(subject, 'p', 'm', Date.parse('2026-04-01'))?.inputPerMillion).toBe(4)
    expect(resolvePrice(subject, 'p', 'm', Date.parse('2026-02-01'))?.inputPerMillion).toBe(3)
  })

  it('skips an entry whose effective date cannot be parsed', () => {
    expect(resolvePrice(catalog(entry({ effectiveFrom: 'not-a-date' })), 'p', 'm', Date.parse('2026-02-01')))
      .toBeUndefined()
  })

  it('keeps the selected price when a later entry in the list is older', () => {
    const subject = catalog(entry({ effectiveFrom: '2026-03-01', inputPerMillion: 4 }), entry())
    expect(resolvePrice(subject, 'p', 'm', Date.parse('2026-04-01'))?.inputPerMillion).toBe(4)
  })
})

describe('priceUsage', () => {
  it('reports no-recorded-usage when every bucket is zero', () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(priceUsage(SHIPPED_PRICING_CATALOG, usage, { provider: 'p', model: 'm' }, 0))
      .toEqual({ kind: 'unknown', reason: 'no-recorded-usage' })
  })

  it('reports no-catalog-entry when no price covers the route', () => {
    const usage = { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(priceUsage(SHIPPED_PRICING_CATALOG, usage, { provider: 'p', model: 'm' }, Date.parse('2026-05-01')))
      .toEqual({ kind: 'unknown', reason: 'no-catalog-entry' })
  })

  it('charges input and output at their own rates', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 2_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(priceUsage(catalog(entry()), usage, { provider: 'p', model: 'm' }, Date.parse('2026-05-01')))
      .toEqual({ kind: 'known', currency: 'USD', amount: 33, catalogVersion: '2' })
  })

  it('charges cache reads at zero when the provider publishes no cache rate', () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 }
    expect(priceUsage(catalog(entry()), usage, { provider: 'p', model: 'm' }, Date.parse('2026-05-01')))
      .toEqual({ kind: 'known', currency: 'USD', amount: 0, catalogVersion: '2' })
  })

  it('charges cache reads at their published rate', () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 }
    const priced = catalog(entry({ cacheReadPerMillion: 0.3 }))
    expect(priceUsage(priced, usage, { provider: 'p', model: 'm' }, Date.parse('2026-05-01')))
      .toEqual({ kind: 'known', currency: 'USD', amount: 0.3, catalogVersion: '2' })
  })

  it('prices cache writes at zero because no provider publishes that rate', () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 }
    expect(priceUsage(catalog(entry()), usage, { provider: 'p', model: 'm' }, Date.parse('2026-05-01')))
      .toEqual({ kind: 'known', currency: 'USD', amount: 0, catalogVersion: '2' })
  })
})

describe('totalCost', () => {
  it('sums one currency and rounds to six decimals', () => {
    expect(totalCost([
      { kind: 'known', currency: 'USD', amount: 1.0000004, catalogVersion: '2' },
      { kind: 'known', currency: 'USD', amount: 2, catalogVersion: '2' },
    ])).toEqual({ kind: 'known', currency: 'USD', amount: 3, catalogVersion: '2' })
  })

  it('keeps the first unknown reason when nothing is priced', () => {
    expect(totalCost([{ kind: 'unknown', reason: 'no-catalog-entry' }]))
      .toEqual({ kind: 'unknown', reason: 'no-catalog-entry' })
  })

  it('reports no-recorded-usage for an empty list', () => {
    expect(totalCost([])).toEqual({ kind: 'unknown', reason: 'no-recorded-usage' })
  })

  it('refuses a total that mixes currencies', () => {
    expect(totalCost([
      { kind: 'known', currency: 'USD', amount: 1, catalogVersion: '2' },
      { kind: 'known', currency: 'EUR', amount: 1, catalogVersion: '2' },
    ])).toEqual({ kind: 'unknown', reason: 'mixed-currency' })
  })

  it('refuses a partial total when any route is unpriced', () => {
    expect(totalCost([
      { kind: 'known', currency: 'USD', amount: 1, catalogVersion: '2' },
      { kind: 'unknown', reason: 'no-recorded-usage' },
    ])).toEqual({ kind: 'unknown', reason: 'no-catalog-entry' })
  })
})

describe('SHIPPED_PRICING_CATALOG', () => {
  it('ships no prices, so nothing is claimed without a sourced entry', () => {
    expect(SHIPPED_PRICING_CATALOG.entries).toEqual([])
    expect(SHIPPED_PRICING_CATALOG.version).toBe('0')
  })
})

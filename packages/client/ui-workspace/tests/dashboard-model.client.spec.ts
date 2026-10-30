// Dashboard totals: every figure is a projection or list fact; archived rows
// stay out, unmeasured rows never contribute zeroes, and spend is only ever
// reported through a sourced, effective-dated price.

import { describe, expect, it } from 'vitest'
import { dashboardFacts, type DashboardSession } from '../src/client/dashboard-model.ts'
import type { DashboardPricingCatalog } from '../src/client/dashboard-pricing.ts'

function session(overrides: Partial<DashboardSession> & { id: string }): DashboardSession {
  return {
    title: overrides.id,
    running: false,
    updatedAt: 1,
    workspace: 'ws',
    turns: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    recorded: true,
    ...overrides,
  }
}

const catalog: DashboardPricingCatalog = {
  version: '7',
  entries: [
    {
      provider: 'openrouter',
      model: 'one',
      currency: 'USD',
      inputPerMillion: 1,
      outputPerMillion: 2,
      cacheReadPerMillion: 0.5,
      source: 'fixture rate card',
      effectiveFrom: '2026-01-01',
    },
  ],
}

describe('dashboard facts', () => {
  it('folds visible sessions into totals, breakdowns, and the recent list', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', updatedAt: 10, turns: 2, steps: 5, outputTokens: 100, running: true, provider: 'openrouter', model: 'one', preset: 'standard' }),
        session({ id: 'b', updatedAt: 20, turns: 3, steps: 7, outputTokens: 50, provider: 'openrouter', model: 'one', preset: 'army', subagent: true }),
        session({ id: 'c', updatedAt: 30, turns: 1, steps: 2, outputTokens: 25, provider: 'local', model: 'two' }),
      ],
      workspaces: [
        { id: 'w1', title: 'One', sessionIds: ['a', 'b'] },
        { id: 'w2', title: 'Two', sessionIds: ['c'] },
      ],
      archivedSessionIds: [],
    })
    expect(facts).toMatchObject({
      sessions: 3,
      workspaces: 2,
      running: 1,
      subagents: 1,
      turns: 6,
      steps: 14,
      outputTokens: 175,
      dataState: 'complete',
      unmeasured: 0,
    })
    expect(facts.models.map(model => [model.route, model.count])).toEqual([
      ['openrouter · one', 2],
      ['local · two', 1],
    ])
    expect(facts.providers).toEqual([
      { provider: 'openrouter', count: 2 },
      { provider: 'local', count: 1 },
    ])
    expect(facts.presets).toEqual([
      { preset: 'army', count: 1 },
      { preset: 'standard', count: 1 },
    ])
    expect(facts.recent.map(row => row.id)).toEqual(['c', 'b', 'a'])
    expect(facts.recent[0]?.model).toBe('local · two')
  })

  it('excludes archived sessions from every figure', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', turns: 2, outputTokens: 10 }),
        session({ id: 'b', turns: 5, outputTokens: 99 }),
      ],
      workspaces: [],
      archivedSessionIds: ['b'],
    })
    expect(facts.sessions).toBe(1)
    expect(facts.turns).toBe(2)
    expect(facts.outputTokens).toBe(10)
    expect(facts.recent.map(row => row.id)).toEqual(['a'])
  })

  it('keeps a session without a recorded model out of the model breakdown', () => {
    const facts = dashboardFacts({
      sessions: [session({ id: 'a' }), session({ id: 'b', provider: 'p', model: 'm' })],
      workspaces: [],
      archivedSessionIds: [],
    })
    expect(facts.models.map(model => model.route)).toEqual(['p · m'])
    expect(facts.recent.find(row => row.id === 'a')?.model).toBeUndefined()
  })

  it('limits the recent list to the newest eight', () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session({ id: `s${index}`, updatedAt: index }))
    const facts = dashboardFacts({ sessions, workspaces: [], archivedSessionIds: [] })
    expect(facts.recent).toHaveLength(8)
    expect(facts.recent[0]?.id).toBe('s9')
    expect(facts.recent[7]?.id).toBe('s2')
  })

  it('reports a session without projections as partial instead of zero work', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', turns: 4, steps: 9, outputTokens: 10 }),
        session({ id: 'b', recorded: false, turns: 99, steps: 99, outputTokens: 99 }),
      ],
      workspaces: [],
      archivedSessionIds: [],
    })
    expect(facts.dataState).toBe('partial')
    expect(facts.unmeasured).toBe(1)
    expect(facts.turns).toBe(4)
    expect(facts.outputTokens).toBe(10)
    expect(facts.recent.find(row => row.id === 'b')).toMatchObject({ recorded: false, turns: 0, outputTokens: 0 })
  })

  it('reports the empty state when no visible session exists', () => {
    const facts = dashboardFacts({ sessions: [], workspaces: [], archivedSessionIds: [] })
    expect(facts.dataState).toBe('empty')
    expect(facts.cost).toEqual({ kind: 'unknown', reason: 'no-recorded-usage' })
  })

  it('prices a route from an effective catalog entry and keeps the catalog version', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', updatedAt: Date.parse('2026-05-01'), provider: 'openrouter', model: 'one', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
      ],
      workspaces: [],
      archivedSessionIds: [],
      pricing: catalog,
    })
    expect(facts.models[0]?.cost).toEqual({ kind: 'known', currency: 'USD', amount: 3.5, catalogVersion: '7' })
    expect(facts.cost).toEqual({ kind: 'known', currency: 'USD', amount: 3.5, catalogVersion: '7' })
    expect(facts.catalogVersion).toBe('7')
  })

  it('stays unpriced when a route has no catalog entry, even beside a priced one', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', updatedAt: Date.parse('2026-05-01'), provider: 'openrouter', model: 'one', inputTokens: 10 }),
        session({ id: 'b', updatedAt: Date.parse('2026-05-01'), provider: 'other', model: 'two', inputTokens: 10 }),
      ],
      workspaces: [],
      archivedSessionIds: [],
      pricing: catalog,
    })
    expect(facts.models[0]?.cost.kind).toBe('known')
    expect(facts.cost).toEqual({ kind: 'unknown', reason: 'no-catalog-entry' })
  })

  it('stays unpriced when the only price took effect after the observation', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', updatedAt: Date.parse('2025-12-31'), provider: 'openrouter', model: 'one', inputTokens: 10 }),
      ],
      workspaces: [],
      archivedSessionIds: [],
      pricing: catalog,
    })
    expect(facts.cost).toEqual({ kind: 'unknown', reason: 'no-catalog-entry' })
  })

  it('breaks equal recency and equal usage by id and route', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'b', updatedAt: 5, provider: 'z', model: 'z' }),
        session({ id: 'a', updatedAt: 5, provider: 'a', model: 'a' }),
      ],
      workspaces: [],
      archivedSessionIds: [],
    })
    expect(facts.recent.map(row => row.id)).toEqual(['a', 'b'])
    expect(facts.models.map(model => model.route)).toEqual(['a · a', 'z · z'])
  })

  it('reports only the reasons a mixed-currency total can carry', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', updatedAt: Date.parse('2026-05-01'), provider: 'openrouter', model: 'one', inputTokens: 10 }),
        session({ id: 'b', updatedAt: Date.parse('2026-05-01'), provider: 'euro', model: 'one', inputTokens: 10 }),
      ],
      workspaces: [],
      archivedSessionIds: [],
      pricing: {
        version: '9',
        entries: [
          ...catalog.entries,
          {
            provider: 'euro',
            model: 'one',
            currency: 'EUR',
            inputPerMillion: 1,
            outputPerMillion: 1,
            source: 'fixture rate card',
            effectiveFrom: '2026-01-01',
          },
        ],
      },
    })
    expect(facts.cost).toEqual({ kind: 'unknown', reason: 'mixed-currency' })
    expect(facts.catalogVersion).toBe('9')
  })
})

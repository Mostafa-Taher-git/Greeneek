// Dashboard totals: every figure is a projection or list fact; archived and
// blank sessions stay out of the summary.

import { describe, expect, it } from 'vitest'
import { dashboardFacts, type DashboardSession } from '../src/client/dashboard-model.ts'

function session(overrides: Partial<DashboardSession> & { id: string }): DashboardSession {
  return {
    title: overrides.id,
    running: false,
    updatedAt: 1,
    workspace: 'ws',
    turns: 0,
    steps: 0,
    outputTokens: 0,
    ...overrides,
  }
}

describe('dashboard facts', () => {
  it('folds visible sessions into totals, model usage, and the recent list', () => {
    const facts = dashboardFacts({
      sessions: [
        session({ id: 'a', updatedAt: 10, turns: 2, steps: 5, outputTokens: 100, running: true, provider: 'openrouter', model: 'one' }),
        session({ id: 'b', updatedAt: 20, turns: 3, steps: 7, outputTokens: 50, provider: 'openrouter', model: 'one' }),
        session({ id: 'c', updatedAt: 30, turns: 1, steps: 2, outputTokens: 25, provider: 'local', model: 'two' }),
      ],
      workspaces: [
        { id: 'w1', title: 'One', sessionIds: ['a', 'b'] },
        { id: 'w2', title: 'Two', sessionIds: ['c'] },
      ],
      archivedSessionIds: [],
    })
    expect(facts).toMatchObject({ sessions: 3, workspaces: 2, running: 1, turns: 6, steps: 14, outputTokens: 175 })
    expect(facts.models).toEqual([
      { route: 'openrouter · one', count: 2 },
      { route: 'local · two', count: 1 },
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
    expect(facts.models).toEqual([{ route: 'p · m', count: 1 }])
    expect(facts.recent.find(row => row.id === 'a')?.model).toBeUndefined()
  })

  it('limits the recent list to the newest eight', () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session({ id: `s${index}`, updatedAt: index }))
    const facts = dashboardFacts({ sessions, workspaces: [], archivedSessionIds: [] })
    expect(facts.recent).toHaveLength(8)
    expect(facts.recent[0]?.id).toBe('s9')
    expect(facts.recent[7]?.id).toBe('s2')
  })
})

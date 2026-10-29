import { describe, expect, it } from 'vitest'
import { TeamError } from '../src/error.ts'
import { assertDisjointLaneScopes, resolveLanePolicy } from '../src/lane-policy.ts'

/** Await one rejection and keep its typed Team error. */
async function rejection(operation: () => unknown): Promise<TeamError> {
  try {
    await operation()
  } catch (error) {
    if (error instanceof TeamError) return error
    throw error
  }
  throw new Error('expected the operation to reject')
}

describe('lane policy', () => {
  it('resolves shared, read-only, and isolated lanes', () => {
    expect(resolveLanePolicy({})).toEqual({ kind: 'shared' })
    expect(resolveLanePolicy({ readOnly: false })).toEqual({ kind: 'shared' })
    expect(resolveLanePolicy({ readOnly: true })).toEqual({ kind: 'read-only' })
    expect(resolveLanePolicy({ writeScopes: ['./src/app/', 'docs', 'src/app'] })).toEqual({
      kind: 'isolated',
      writeScopes: ['src/app', 'docs'],
    })
  })

  it('refuses contradictory or empty lane fields', async () => {
    expect((await rejection(() => resolveLanePolicy({ readOnly: true, writeScopes: ['src'] }))).code)
      .toBe('TEAM_INVALID_LANE_POLICY')
    expect((await rejection(() => resolveLanePolicy({ writeScopes: [] }))).code)
      .toBe('TEAM_INVALID_LANE_POLICY')
    expect((await rejection(() => resolveLanePolicy({ writeScopes: ['../escape'] }))).code)
      .toBe('TEAM_INVALID_WRITE_SCOPE')
    expect((await rejection(() => resolveLanePolicy({ writeScopes: ['/absolute'] }))).code)
      .toBe('TEAM_INVALID_WRITE_SCOPE')
  })

  it('admits disjoint scopes and names the first overlapping pair', async () => {
    expect(() => {
      assertDisjointLaneScopes(
        { lane: 'docs', writeScopes: ['docs'] },
        [{ lane: 'code', writeScopes: ['src'] }, { lane: 'tests', writeScopes: ['test'] }],
      )
    }).not.toThrow()

    const error = await rejection(() => {
      assertDisjointLaneScopes(
        { lane: 'docs', writeScopes: ['src/docs'] },
        [{ lane: 'code', writeScopes: ['src'] }],
      )
    })
    expect(error.code).toBe('TEAM_LANE_SCOPE_OVERLAP')
    expect(error.message).toContain('"docs"')
    expect(error.message).toContain('"code"')
  })

  it('ignores the candidate lane itself when re-admitting', () => {
    expect(() => {
      assertDisjointLaneScopes({ lane: 'code', writeScopes: ['src'] }, [{ lane: 'code', writeScopes: ['src'] }])
    }).not.toThrow()
  })
})

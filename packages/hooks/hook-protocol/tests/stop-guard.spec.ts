import { describe, expect, it } from 'vitest'
import { MAX_STOP_FORCED_CONTINUATIONS, StopLoopGuard } from '../src/index.ts'

describe('StopLoopGuard', () => {
  it('admits the cap-many continuations for one turn, then opens', () => {
    const guard = new StopLoopGuard()
    const agent = {}
    for (let index = 0; index < MAX_STOP_FORCED_CONTINUATIONS; index += 1) {
      expect(guard.shouldContinue(agent, 7)).toBe(true)
    }
    expect(guard.shouldContinue(agent, 7)).toBe(false)
    expect(guard.shouldContinue(agent, 7)).toBe(false)
  })

  it('restarts the count on a new turn number', () => {
    const guard = new StopLoopGuard()
    const agent = {}
    for (let index = 0; index < MAX_STOP_FORCED_CONTINUATIONS; index += 1) {
      expect(guard.shouldContinue(agent, 1)).toBe(true)
    }
    expect(guard.shouldContinue(agent, 1)).toBe(false)
    expect(guard.shouldContinue(agent, 2)).toBe(true)
  })

  it('counts agents independently', () => {
    const guard = new StopLoopGuard()
    const first = {}
    const second = {}
    for (let index = 0; index < MAX_STOP_FORCED_CONTINUATIONS; index += 1) {
      expect(guard.shouldContinue(first, 3)).toBe(true)
      expect(guard.shouldContinue(second, 3)).toBe(true)
    }
    expect(guard.shouldContinue(first, 3)).toBe(false)
    expect(guard.shouldContinue(second, 3)).toBe(false)
  })

  it('treats a repeated turn number after exhaustion as the same capped turn', () => {
    const guard = new StopLoopGuard()
    const agent = {}
    for (let index = 0; index < MAX_STOP_FORCED_CONTINUATIONS; index += 1) {
      guard.shouldContinue(agent, 5)
    }
    // A new agent object starts fresh even on the same turn number.
    const other = {}
    expect(guard.shouldContinue(other, 5)).toBe(true)
  })
})

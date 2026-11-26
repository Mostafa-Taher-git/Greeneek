import { describe, expect, it } from 'vitest'
import { nextOccurrence } from '../src/timing.ts'
import type { AutomationTask } from '../src/types.ts'

function task(repeat: AutomationTask['timing']['repeat'], at: string, timeZone = 'UTC'): AutomationTask {
  return {
    id: 'a', title: 'task', prompt: 'prompt', status: 'active',
    target: { kind: 'new_once', cwd: null, sessionId: null },
    timing: { repeat, at, timeZone }, createdAt: at, updatedAt: at,
    lastRunAt: null, history: [],
  }
}

describe('automation timing', () => {
  it('returns the one-shot instant only before it is consumed', () => {
    const value = task('once', '2026-01-01T12:00:00.000Z')
    expect(nextOccurrence(value, Date.parse('2026-01-01T11:59:59.999Z'))).toBe(Date.parse(value.timing.at!))
    expect(nextOccurrence(value, Date.parse(value.timing.at!))).toBeUndefined()
  })

  it('keeps hourly intervals anchored to the original instant', () => {
    const value = task('hourly', '2026-01-01T12:15:00.000Z')
    expect(nextOccurrence(value, Date.parse('2026-01-01T15:00:00.000Z')))
      .toBe(Date.parse('2026-01-01T15:15:00.000Z'))
  })

  it('uses the selected zone wall clock across daylight saving changes', () => {
    const value = task('daily', '2026-03-07T14:30:00.000Z', 'America/New_York')
    expect(nextOccurrence(value, Date.parse('2026-03-07T15:00:00.000Z')))
      .toBe(Date.parse('2026-03-08T13:30:00.000Z'))
  })

  it('keeps weekly runs on the task anchor weekday', () => {
    const value = task('weekly', '2026-01-05T09:00:00.000Z')
    expect(nextOccurrence(value, Date.parse('2026-01-06T00:00:00.000Z')))
      .toBe(Date.parse('2026-01-12T09:00:00.000Z'))
  })
})

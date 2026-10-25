/**
 * Pure behavior of the tool-owned argument validators: provider defaults and
 * route mapping, the bounds the registry schema cannot express, and the
 * collection of every violation into one `ToolArgsError`.
 *
 * @module tool-wave/tests/arguments
 */

import { describe, expect, it } from 'vitest'
import { MAX_MEMBERS, parseCancelArguments, parseDispatchArguments } from '../src/arguments.ts'
import type { ToolArgsError } from '@greeneek/gnk-tools'

/** Capture one validator throw; undefined means it did not throw. */
function throwOf(run: () => unknown): ToolArgsError | undefined {
  try {
    run()
  } catch (error: unknown) {
    return error as ToolArgsError
  }
  return undefined
}

describe('parseDispatchArguments', () => {
  it('defaults member providers to the configured provider and maps roles and routes', () => {
    const request = parseDispatchArguments({
      label: 'hail fleet',
      members: [
        { prompt: 'alpha' },
        { prompt: 'beta', role: 'scout' },
        { prompt: 'gamma', provider: 'alternate' },
        { prompt: 'delta', model: 'm1', reasoning_effort: 'low' },
        { prompt: 'epsilon', model: 'm2' },
        { prompt: 'zeta', reasoning_effort: 'high' },
      ],
    }, 'configured')
    expect(request.label).toBe('hail fleet')
    expect(request.members).toHaveLength(6)
    expect(request.members[0]).toEqual({ provider: 'configured', request: { prompt: [{ type: 'text', text: 'alpha' }] } })
    expect(request.members[1]).toEqual({
      provider: 'configured',
      role: 'scout',
      request: { prompt: [{ type: 'text', text: 'beta' }] },
    })
    expect(request.members[2]).toEqual({ provider: 'alternate', request: { prompt: [{ type: 'text', text: 'gamma' }] } })
    expect(request.members[3]?.request.agentOptions).toEqual({ model: 'm1', reasoningEffort: 'low' })
    expect(request.members[4]?.request.agentOptions).toEqual({ model: 'm2' })
    expect(request.members[5]?.request.agentOptions).toEqual({ reasoningEffort: 'high' })
  })

  it('keeps the completion policy and both kinds of budget', () => {
    const request = parseDispatchArguments({
      label: 'policied',
      members: [{ prompt: 'task' }],
      on_complete: 'fail-fast',
      max_tokens_per_member: 10,
      max_wave_tokens: 40,
    }, 'configured')
    expect(request.label).toBe('policied')
    expect(request.members).toHaveLength(1)
    expect(request.onComplete).toBe('fail-fast')
    expect(request.maxTokensPerMember).toBe(10)
    expect(request.maxWaveTokens).toBe(40)
  })

  it('rejects a member list entry count outside the fleet bounds', () => {
    const empty = throwOf(() => parseDispatchArguments({ label: 'x', members: [] }, 'configured'))
    expect(empty?.violations).toEqual(['a wave requires at least one member'])
    const flood = Array.from({ length: MAX_MEMBERS + 1 }, () => ({ prompt: 'task' }))
    const over = throwOf(() => parseDispatchArguments({ label: 'x', members: flood }, 'configured'))
    expect(over?.violations).toEqual([`a wave carries at most ${MAX_MEMBERS} members`])
  })

  it('rejects non-positive and unsafe budgets for both ceiling kinds', () => {
    const invalid = throwOf(() => parseDispatchArguments({
      label: 'x',
      members: [{ prompt: 'task' }],
      max_tokens_per_member: 0,
      max_wave_tokens: 1e21,
    }, 'configured'))
    expect(invalid?.violations).toEqual([
      'max_tokens_per_member must be a positive token budget',
      'max_wave_tokens must be a safe integer token budget',
    ])
  })

  it('collects undeclared arguments next to the other violations', () => {
    const junk = {
      label: 'crowded',
      members: [],
      max_result_bytes: 500,
      max_concurrent: 4,
    } as unknown as Parameters<typeof parseDispatchArguments>[0]
    const error = throwOf(() => parseDispatchArguments(junk, 'configured'))
    expect(error?.violations).toEqual([
      'max_result_bytes is not an accepted argument for this wave tool',
      'max_concurrent is not an accepted argument for this wave tool',
      'a wave requires at least one member',
    ])
  })
})

describe('parseCancelArguments', () => {
  it('returns the addressed wave id, or undefined for cancel-all', () => {
    expect(parseCancelArguments({})).toEqual({ wave_id: undefined })
    expect(parseCancelArguments({ wave_id: 'some-wave' })).toEqual({ wave_id: 'some-wave' })
  })

  it('rejects undeclared arguments', () => {
    const junk = throwOf(() =>
      parseCancelArguments({ wave_id: 'w', extra: true } as unknown as Parameters<typeof parseCancelArguments>[0]))
    expect(junk?.violations).toEqual(['extra is not an accepted argument for this wave tool'])
  })
})

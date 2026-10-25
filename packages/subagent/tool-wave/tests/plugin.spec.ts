/**
 * Integration behavior of the fleet tools over the real wave engine: the
 * four-member dispatch with per-member routes, engine caps and budgets,
 * cancellation scoping through parent-retained views, and the no-agent and
 * unknown-provider failures.
 *
 * @module tool-wave/tests/plugin
 */

import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@greeneek/gnk-llm'
import {
  callTool,
  childAgent,
  completed,
  preStep,
  setupWaveTool,
  text,
  usage,
  waveEventTypes,
} from './harness.ts'

describe('wave_dispatch', () => {
  it('renders the settled four-member fleet with per-member routes, roles, and structured values', async () => {
    const { ctx, waves, provider, alternate, parent } = await setupWaveTool({}, { alternate: true })
    const pending = callTool(ctx, 'wave_dispatch', {
      label: 'fleet survey',
      on_complete: 'continue-others',
      members: [
        { prompt: 'alpha task', role: 'researcher' },
        { prompt: 'beta task', model: 'fast-model' },
        { prompt: 'gamma task', reasoning_effort: 'high' },
        { prompt: 'delta task', provider: 'alternate', model: 'slow-model', reasoning_effort: 'low' },
      ],
    })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(3) })
    await vi.waitFor(() => { expect(alternate?.runs).toHaveLength(1) })
    provider.runs[0]!.deferred.resolve(completed('alpha answer'))
    provider.runs[1]!.deferred.resolve(completed('beta answer', { checked: [1, 2] }))
    provider.runs[2]!.deferred.resolve(completed('gamma answer'))
    alternate!.runs[0]!.deferred.resolve(completed('delta answer'))

    const result = await pending
    expect(result.isError).toBe(false)
    const waveId = String(waves.listWaves(parent.id)[0]!.waveId)
    expect(waves.listWaves(parent.id)[0]?.closed).toBe(true)
    expect(text(result)).toEqual([
      `Wave ${waveId} settled: completed, 4 member row(s).`,
      '[0] controlled (researcher) — completed — 0 tokens',
      '  child session controlled-child-0, stop reason completed',
      '  output: alpha answer',
      '[1] controlled — completed — 0 tokens',
      '  child session controlled-child-1, stop reason completed, model fast-model',
      '  structured: {"checked":[1,2]}',
      '  output: beta answer',
      '[2] controlled — completed — 0 tokens',
      '  child session controlled-child-2, stop reason completed',
      '  output: gamma answer',
      '[3] alternate — completed — 0 tokens',
      '  child session alternate-child-0, stop reason completed, model slow-model',
      '  output: delta answer',
    ].join('\n'))

    // The wave logged its admission, one settlement per member, and the closing record.
    const types = waveEventTypes(parent)
    expect(types).toHaveLength(6)
    expect(types[0]).toBe('wave/initiated')
    expect(types.at(-1)).toBe('wave/settled')

    // Member requests carried the engine member fields: standalone prompts and routes.
    expect(provider.requests[0]?.prompt).toEqual([{ type: 'text', text: 'alpha task' }])
    expect(provider.requests[0]?.agentOptions).toBeUndefined()
    expect(provider.requests[1]?.agentOptions).toEqual({ model: 'fast-model' })
    expect(provider.requests[2]?.agentOptions).toEqual({ reasoningEffort: 'high' })
    expect(provider.requests[0]?.signal.aborted).toBe(false)
    expect(alternate?.requests[0]?.agentOptions).toEqual({ model: 'slow-model', reasoningEffort: 'low' })
  })

  it('marks engine-capped rows truncated and keeps only their capped text', async () => {
    const { ctx, waves, provider, parent } = await setupWaveTool({ maxResultBytes: 1024 })
    const pending = callTool(ctx, 'wave_dispatch', {
      label: 'loud member',
      members: [{ prompt: 'shout', role: 'speaker' }],
    })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.deferred.resolve(completed('x'.repeat(1100)))
    const result = await pending
    expect(result.isError).toBe(false)
    const waveId = String(waves.listWaves(parent.id)[0]!.waveId)
    expect(text(result)).toEqual([
      `Wave ${waveId} settled: completed, 1 member row(s).`,
      '[0] controlled (speaker) — completed — 0 tokens',
      '  child session controlled-child-0, stop reason completed, truncated',
      `  output: ${'x'.repeat(1024)}`,
    ].join('\n'))
  })

  it('reports a fail-fast budget kill as a budget-killed row on the waiting dispatch', async () => {
    const { ctx, waves, provider, parent } = await setupWaveTool()
    const pending = callTool(ctx, 'wave_dispatch', {
      label: 'metered member',
      on_complete: 'fail-fast',
      max_tokens_per_member: 10,
      members: [{ prompt: 'burn' }],
    })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue(usage(11))
    await expect(preStep(ctx, childAgent(provider.runs[0]!))).resolves.toEqual({ kind: 'reject' })
    const result = await pending
    expect(result.isError).toBe(false)
    const waveId = String(waves.listWaves(parent.id)[0]!.waveId)
    expect(text(result)).toEqual([
      `Wave ${waveId} settled: partial, 1 member row(s).`,
      '[0] controlled — budget-killed — 11 tokens',
      '  child session controlled-child-0, stop reason aborted',
      '  diagnostic: member token budget exceeded',
      '  output: ',
    ].join('\n'))
    expect(provider.requests[0]?.signal.aborted).toBe(true)
  })

  it('fails a dispatch whose member names an unregistered provider', async () => {
    const { ctx, provider } = await setupWaveTool()
    const result = await callTool(ctx, 'wave_dispatch', {
      label: 'ghost fleet',
      members: [{ prompt: 'task', provider: 'ghost-provider' }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no subagent provider registered for "ghost-provider"')
    expect(provider.requests).toHaveLength(0)
  })

  it('surfaces argument errors as tool failures without starting a wave', async () => {
    const { ctx, provider } = await setupWaveTool()
    const empty = await callTool(ctx, 'wave_dispatch', { label: 'empty', members: [] })
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('a wave requires at least one member')
    const undeclared = await callTool(ctx, 'wave_dispatch', {
      label: 'crowded',
      members: [{ prompt: 'task' }],
      max_result_bytes: 500,
      max_concurrent: 4,
    })
    expect(undeclared.isError).toBe(true)
    expect(text(undeclared)).toContain('max_result_bytes is not an accepted argument for this wave tool')
    expect(text(undeclared)).toContain('max_concurrent is not an accepted argument for this wave tool')
    const noPrompt = await callTool(ctx, 'wave_dispatch', { label: 'x', members: [{ role: 'reviewer' }] })
    expect(noPrompt.isError).toBe(true)
    expect(text(noPrompt)).toContain('prompt')
    const junkMember = await callTool(ctx, 'wave_dispatch', {
      label: 'x',
      members: [{ prompt: 'task', extra_key: 'junk' }],
    })
    expect(junkMember.isError).toBe(true)
    expect(text(junkMember)).toContain('extra_key')
    expect(provider.requests).toHaveLength(0)
  })

  it('requires a calling agent to own the wave', async () => {
    const { ctx } = await setupWaveTool()
    const result = await callTool(
      ctx,
      'wave_dispatch',
      { label: 'unowned', members: [{ prompt: 'task' }] },
      { agent: undefined },
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: wave_dispatch requires a calling agent (exec.agent was undefined)')
  })

  it('classifies both fleet tools concurrency-safe for sibling overlap', async () => {
    const { ctx } = await setupWaveTool()
    expect(ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('mode-dispatch'),
      name: 'wave_dispatch',
      arguments: { label: 'sibling fleet', members: [{ prompt: 'task' }] },
    })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('mode-cancel'),
      name: 'wave_cancel',
      arguments: {},
    })).toEqual({ kind: 'parallel' })
    // Argument-starved calls never join a parallel group.
    expect(ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('mode-invalid'),
      name: 'wave_dispatch',
      arguments: { members: [{ prompt: 'task' }] },
    })).toEqual({ kind: 'exclusive' })
  })
})

describe('wave_cancel', () => {
  it('cancels every unsettled fleet without a wave_id, leaving the queued member without a child', async () => {
    const { ctx, waves, provider, parent } = await setupWaveTool({ maxConcurrent: 1 })
    const pending = callTool(ctx, 'wave_dispatch', {
      label: 'two-step fleet',
      members: [{ prompt: 'first thing' }, { prompt: 'second thing' }],
    })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    const cancelled = await callTool(ctx, 'wave_cancel', {})
    expect(cancelled.isError).toBe(false)
    const waveId = String(waves.listWaves(parent.id)[0]!.waveId)
    expect(text(cancelled)).toBe(`Wave ${waveId} cancelled.`)
    const result = await pending
    expect(text(result)).toEqual([
      `Wave ${waveId} settled: cancelled, 2 member row(s).`,
      '[0] controlled — cancelled — 0 tokens',
      '  child session controlled-child-0, stop reason aborted',
      '  output: ',
      '[1] controlled — cancelled — 0 tokens',
      '  diagnostic: wave cancelled',
      '  output: ',
    ].join('\n'))
    const types = waveEventTypes(parent)
    expect(types).toHaveLength(4)
    expect(types.at(-1)).toBe('wave/settled')
  })

  it('cancels exactly one open wave by id and denies foreign wave ids', async () => {
    const { ctx, waves, provider, parent } = await setupWaveTool()
    const pending = callTool(ctx, 'wave_dispatch', {
      label: 'open fleet',
      members: [{ prompt: 'solo task' }],
    })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    const denial = await callTool(ctx, 'wave_cancel', { wave_id: 'ghost-wave' })
    expect(denial.isError).toBe(false)
    expect(text(denial)).toBe('Wave ghost-wave is not retained for this session.')
    expect(provider.requests[0]?.signal.aborted).toBe(false)
    provider.runs[0]!.deferred.resolve(completed('finished on its own'))
    await expect(pending).resolves.not.toBeNull()
    const settled = waveEventTypes(parent)
    expect(settled).toHaveLength(3)
    const closedId = String(waves.listWaves(parent.id)[0]!.waveId)
    const closed = await callTool(ctx, 'wave_cancel', { wave_id: closedId })
    expect(text(closed)).toBe(`Wave ${closedId} already settled.`)
    expect(waves.listWaves(parent.id)[0]?.closed).toBe(true)
    expect(waveEventTypes(parent)).toHaveLength(3)
  })

  it('renders one row per retained wave: the settled wave first, the open wave second', async () => {
    const { ctx, waves, provider, parent } = await setupWaveTool()
    const first = callTool(ctx, 'wave_dispatch', { label: 'first fleet', members: [{ prompt: 'one' }] })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.deferred.resolve(completed('settled early'))
    await first
    const second = callTool(ctx, 'wave_dispatch', { label: 'second fleet', members: [{ prompt: 'two' }] })
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(2) })
    const cancelled = await callTool(ctx, 'wave_cancel', {})
    expect(cancelled.isError).toBe(false)
    const ids = waves.listWaves(parent.id).map(view => String(view.waveId))
    expect(ids).toHaveLength(2)
    expect(text(cancelled)).toBe(`Wave ${ids[0]} already settled.\nWave ${ids[1]} cancelled.`)
    const result = await second
    expect(text(result)).toContain('settled: cancelled, 1 member row(s).')
  })

  it('reports an empty session when no wave is retained', async () => {
    const { ctx } = await setupWaveTool()
    const result = await callTool(ctx, 'wave_cancel', {})
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('No retained waves for this session.')
  })

  it('requires a calling agent to scope the cancellation', async () => {
    const { ctx } = await setupWaveTool()
    const result = await callTool(ctx, 'wave_cancel', { wave_id: 'some-wave' }, { agent: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: wave_cancel requires a calling agent (exec.agent was undefined)')
  })
})

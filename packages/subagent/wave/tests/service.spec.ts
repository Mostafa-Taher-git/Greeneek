import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { SessionId } from '@greeneek/gnk-session'
import type { ContentBlock } from '@greeneek/gnk-llm'
import type { ResolvedSubagentStartRequest, SubagentResult, SubagentRun } from '@greeneek/gnk-subagent'
import { truncateUtf8 } from '../src/service.ts'
import WaveRuntime, {
  MAX_CONCURRENT_CEILING,
  MAX_RESULT_BYTES_CEILING,
  WaveError,
  WaveId,
  WaveMemberId,
} from '../src/index.ts'
import {
  childAgent,
  completed,
  ControlledProvider,
  fakeParent,
  member,
  preStep,
  setupWave,
  usage,
  waveRequest,
} from './harness.ts'
import type { ControlledRun } from './harness.ts'

function textBytes(result: { readonly output: readonly ContentBlock[] }): number {
  return result.output.reduce(
    (total, block) => total + (block.type === 'text' ? Buffer.byteLength(block.text, 'utf8') : 0),
    0,
  )
}

/** Provider whose child result rejects on the abort signal instead of resolving. */
class RejectionOnAbortProvider extends ControlledProvider {
  override start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    void super.start(request)
    const run = this.runs[this.runs.length - 1]!
    const deferred = Promise.withResolvers<SubagentResult>()
    request.signal.addEventListener('abort', () => { deferred.reject(new Error('child rejected during abort')) }, { once: true })
    this.runs[this.runs.length - 1] = { ...run, deferred, dispose: run.dispose, result: deferred.promise }
    return Promise.resolve(this.runs[this.runs.length - 1] as ControlledRun)
  }
}

describe('WaveRuntime admission and configuration', () => {
  it('rejects empty waves and unknown providers before launching', async () => {
    const { waves, parent, provider } = await setupWave()
    await expect(waves.startWave(waveRequest(parent, []))).rejects.toMatchObject({
      name: 'WaveError',
      code: 'EMPTY_WAVE',
    })
    await expect(waves.startWave(waveRequest(parent, [member({}, { provider: 'missing' })])))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
    expect(provider.requests).toHaveLength(0)
  })

  it('rejects budgets at admission when token metering is unavailable', async () => {
    const { waves, parent, provider } = await setupWave({}, { meter: false })
    await expect(waves.startWave(waveRequest(parent, [member()], { maxWaveTokens: 10 })))
      .rejects.toMatchObject({ code: 'BUDGET_METER_UNAVAILABLE' })
    await expect(waves.startWave(waveRequest(parent, [member()], { maxTokensPerMember: 10 })))
      .rejects.toMatchObject({ code: 'BUDGET_METER_UNAVAILABLE' })
    expect(provider.requests).toHaveLength(0)
  })

  it.each([
    { maxConcurrent: 0 },
    { maxConcurrent: 1.5 },
    { maxConcurrent: MAX_CONCURRENT_CEILING + 1 },
    { maxResultBytes: 0 },
    { maxResultBytes: 1023 },
    { maxResultBytes: MAX_RESULT_BYTES_CEILING + 1 },
    { maxResultBytes: 1024.5 },
  ])('rejects invalid programmatic config %j', async (config) => {
    // Plugin mounts validate through the Config schema first; a direct
    // WaveRuntime construction still fails loud with the engine's own error.
    expect(() => new WaveRuntime(new Context(), config)).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it('accepts the documented config bounds', async () => {
    const first = await setupWave({ maxConcurrent: MAX_CONCURRENT_CEILING, maxResultBytes: MAX_RESULT_BYTES_CEILING })
    const second = await setupWave({ maxConcurrent: 1, maxResultBytes: 1024 })
    expect(first.waves).toBeInstanceOf(WaveRuntime)
    expect(second.waves).toBeInstanceOf(WaveRuntime)
    expect(new WaveError('bad config', 'INVALID_CONFIG').name).toBe('WaveError')
  })
})

describe('WaveRuntime dispatch and settlement', () => {
  it('bounds concurrency, exposes live views, and returns results in spec order', async () => {
    const { waves, provider, parent } = await setupWave({ maxConcurrent: 2 })
    const pending = waves.startWave(waveRequest(parent, [
      member({ agentOptions: { model: 'model-a' } }, { role: 'research' }),
      member({}, { role: 'review' }),
      member(),
    ]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(2) })

    const listed = waves.listWaves(parent.id)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      label: 'test fleet',
      parentSessionId: parent.id,
      closed: false,
      members: [
        { role: 'research', model: 'model-a', status: 'running', tokensUsed: 0 },
        { role: 'review', status: 'running' },
        { status: 'queued' },
      ],
    })
    expect(waves.remoteExportList(parent.id)).toEqual(listed)
    expect(waves.listWaves(SessionId('other-parent'))).toEqual([])

    provider.runs[1]!.deferred.resolve(completed('second'))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(3) })
    provider.runs[2]!.deferred.resolve(completed('third', { verdict: 'ok' }))
    provider.runs[0]!.deferred.resolve(completed('first'))

    const result = await pending
    expect(result.outcome).toBe('completed')
    expect(result.members.map(row => row.output[0])).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
      { type: 'text', text: 'third' },
    ])
    expect(result.members[2]).toMatchObject({ structured: { verdict: 'ok' }, truncated: false })
    expect(provider.runs.every(run => run.dispose.mock.calls.length === 1)).toBe(true)
    expect(waves.listWaves(parent.id)[0]?.closed).toBe(true)

    const closedView = waves.listWaves(parent.id)[0]!
    waves.cancelMember(closedView.waveId, closedView.members[0]!.memberId)
    waves.cancelWave(closedView.waveId)
    expect(waves.cancelAllForParent(parent.id)).toEqual([])
  })

  it('holds a concurrency slot until child disposal finishes', async () => {
    const { waves, provider, parent } = await setupWave({ maxConcurrent: 1 })
    const pending = waves.startWave(waveRequest(parent, [member(), member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    const disposal = Promise.withResolvers<undefined>()
    provider.runs[0]!.dispose.mockImplementation(() => disposal.promise)

    provider.runs[0]!.deferred.resolve(completed('first'))
    await vi.waitFor(() => { expect(provider.runs[0]!.dispose).toHaveBeenCalledOnce() })
    expect(provider.runs).toHaveLength(1)

    disposal.resolve(undefined)
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(2) })
    provider.runs[1]!.deferred.resolve(completed('second'))
    await expect(pending).resolves.toMatchObject({ outcome: 'completed' })
  })

  it('cancels queued and running members without launching the queued child', async () => {
    const { waves, provider, parent } = await setupWave({ maxConcurrent: 1 })
    const pending = waves.startWave(waveRequest(parent, [member(), member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    const view = waves.listWaves(parent.id)[0]!

    waves.cancelMember(view.waveId, view.members[1]!.memberId)
    await vi.waitFor(() => {
      expect(waves.listWaves(parent.id)[0]?.members[1]?.status).toBe('cancelled')
    })
    expect(provider.requests).toHaveLength(1)

    expect(waves.remoteCancelMember(view.waveId, view.members[0]!.memberId)).toEqual({ cancelled: true })
    waves.cancelMember(view.waveId, view.members[0]!.memberId)
    const result = await pending
    expect(result.outcome).toBe('cancelled')
    expect(result.members.map(row => row.status)).toEqual(['cancelled', 'cancelled'])
    expect(provider.requests[0]?.signal.aborted).toBe(true)
    expect(provider.runs[0]?.dispose).toHaveBeenCalledOnce()
  })

  it('cancels one wave and emergency-stops only open waves for the requested parent', async () => {
    const { waves, provider, parent } = await setupWave()
    const other = fakeParent('other-parent')
    const first = waves.startWave(waveRequest(parent, [member()], { label: 'first' }))
    const second = waves.startWave(waveRequest(parent, [member()], { label: 'second' }))
    const third = waves.startWave(waveRequest(other, [member()], { label: 'other' }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(3) })

    const firstView = waves.listWaves(parent.id).find(wave => wave.label === 'first')!
    expect(waves.remoteCancelWave(firstView.waveId)).toEqual({ cancelled: true })
    await expect(first).resolves.toMatchObject({ outcome: 'cancelled' })
    expect(waves.remoteCancelAll(parent.id).waveIds).toHaveLength(1)
    await expect(second).resolves.toMatchObject({ outcome: 'cancelled' })
    expect(provider.requests[2]?.signal.aborted).toBe(false)

    provider.runs[2]!.deferred.resolve(completed('other'))
    await expect(third).resolves.toMatchObject({ outcome: 'completed' })
  })

  it('fails fast after a launched member fails, but not after a user cancellation', async () => {
    const failed = await setupWave({ maxConcurrent: 2 })
    const failedWave = failed.waves.startWave(waveRequest(failed.parent, [member(), member()], { onComplete: 'fail-fast' }))
    await vi.waitFor(() => { expect(failed.provider.runs).toHaveLength(2) })
    failed.provider.runs[0]!.deferred.resolve({ output: [], diagnostic: 'provider failed', stopReason: 'error' })
    await expect(failedWave).resolves.toMatchObject({
      outcome: 'partial',
      members: [
        { status: 'failed', diagnostic: 'provider failed' },
        { status: 'cancelled' },
      ],
    })

    const cancelled = await setupWave({ maxConcurrent: 2 })
    const cancelledWave = cancelled.waves.startWave(waveRequest(cancelled.parent, [member(), member()], { onComplete: 'fail-fast' }))
    await vi.waitFor(() => { expect(cancelled.provider.runs).toHaveLength(2) })
    const view = cancelled.waves.listWaves(cancelled.parent.id)[0]!
    cancelled.waves.cancelMember(view.waveId, view.members[0]!.memberId)
    await vi.waitFor(() => {
      expect(cancelled.waves.listWaves(cancelled.parent.id)[0]?.members[0]?.status).toBe('cancelled')
    })
    expect(cancelled.provider.requests[1]?.signal.aborted).toBe(false)
    cancelled.provider.runs[1]!.deferred.resolve(completed('survived'))
    await expect(cancelledWave).resolves.toMatchObject({ outcome: 'partial' })
  })

  it('does not fail fast for a provider rejection before child publication', async () => {
    const { ctx, waves, provider, parent } = await setupWave({ maxConcurrent: 2 })
    class RejectingProvider extends ControlledProvider {
      override start(): never {
        throw 'unpublished failure'
      }
    }
    ctx.subagents.registerProvider(new RejectingProvider('rejecting'))
    const pending = waves.startWave(waveRequest(parent, [
      member({}, { provider: 'rejecting' }),
      member(),
    ], { onComplete: 'fail-fast' }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    expect(provider.requests[0]?.signal.aborted).toBe(false)
    provider.runs[0]!.deferred.resolve(completed('survived'))
    await expect(pending).resolves.toMatchObject({
      outcome: 'partial',
      members: [{ status: 'failed', diagnostic: 'unpublished failure' }, { status: 'completed' }],
    })
  })

  it('settles disposal failures and still releases the next member', async () => {
    const { waves, provider, parent } = await setupWave({ maxConcurrent: 1 })
    const pending = waves.startWave(waveRequest(parent, [member(), member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.dispose.mockRejectedValue(new Error('reap failed'))
    provider.runs[0]!.deferred.resolve(completed('not successful'))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(2) })
    provider.runs[1]!.deferred.resolve(completed('next'))
    await expect(pending).resolves.toMatchObject({
      outcome: 'partial',
      members: [
        { status: 'failed', diagnostic: 'dispose failed: reap failed' },
        { status: 'completed' },
      ],
    })
  })

  it('preserves provider and non-Error disposal diagnostics together', async () => {
    const { waves, provider, parent } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.dispose.mockRejectedValue('reap failed')
    provider.runs[0]!.deferred.resolve({ output: [], diagnostic: 'provider failed', stopReason: 'error' })
    await expect(pending).resolves.toMatchObject({
      members: [{ status: 'failed', diagnostic: 'provider failed; dispose failed: reap failed' }],
    })
  })
})

describe('WaveRuntime budget enforcement', () => {
  it('kills a member whose cumulative usage exceeds its cap', async () => {
    const { ctx, waves, provider, parent } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()], { maxTokensPerMember: 10 }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue(usage(11) as never)

    await expect(preStep(ctx, childAgent(provider.runs[0]!))).resolves.toEqual({ kind: 'reject' })
    const result = await pending
    expect(result.members[0]).toMatchObject({ status: 'budget-killed', tokensUsed: 11 })
    expect(provider.requests[0]?.signal.aborted).toBe(true)
  })

  it('aborts every active member when aggregate usage exceeds the wave cap', async () => {
    const { ctx, waves, provider, parent } = await setupWave({ maxConcurrent: 2 })
    const pending = waves.startWave(waveRequest(parent, [member(), member()], { maxWaveTokens: 15 }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(2) })
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue(usage(10) as never)

    await expect(preStep(ctx, childAgent(provider.runs[0]!))).resolves.toEqual({ kind: 'enter', messages: [] })
    await expect(preStep(ctx, childAgent(provider.runs[1]!))).resolves.toEqual({ kind: 'reject' })
    const result = await pending
    expect(result.members.map(row => row.status)).toEqual(['cancelled', 'budget-killed'])
    expect(provider.requests.every(request => request.signal.aborted)).toBe(true)
  })

  it('meters without a cap and delegates zero or unrelated agents', async () => {
    const { ctx, waves, provider, parent } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    const stateOf = vi.spyOn(ctx.sessionProjections, 'stateOf')
    stateOf.mockReturnValue(usage(0) as never)
    await expect(preStep(ctx, childAgent(provider.runs[0]!))).resolves.toEqual({ kind: 'enter', messages: [] })
    stateOf.mockReturnValue(usage(12) as never)
    await expect(preStep(ctx, childAgent(provider.runs[0]!))).resolves.toEqual({ kind: 'enter', messages: [] })
    await expect(preStep(ctx, fakeParent('unrelated'))).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(provider.requests[0]?.signal.aborted).toBe(false)
    provider.runs[0]!.deferred.resolve(completed())
    await expect(pending).resolves.toMatchObject({ members: [{ status: 'completed', tokensUsed: 12 }] })
  })

  it('fails loudly if metering disappears after admission', async () => {
    const { ctx, waves, provider, parent, tokenMeterFiber } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()], { maxWaveTokens: 10 }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    await tokenMeterFiber!.dispose()
    await expect(preStep(ctx, childAgent(provider.runs[0]!))).rejects.toMatchObject({
      code: 'BUDGET_METER_UNAVAILABLE',
    })
    provider.runs[0]!.deferred.resolve({ output: [], stopReason: 'error' })
    await expect(pending).resolves.toMatchObject({ members: [{ status: 'failed' }] })
  })
})

describe('WaveRuntime result limits', () => {
  it('keeps exact-limit text and truncates multibyte text across blocks', async () => {
    const exact = await setupWave({ maxResultBytes: 1024 })
    const exactWave = exact.waves.startWave(waveRequest(exact.parent, [member()]))
    await vi.waitFor(() => { expect(exact.provider.runs).toHaveLength(1) })
    exact.provider.runs[0]!.deferred.resolve(completed('x'.repeat(1024)))
    await expect(exactWave).resolves.toMatchObject({ members: [{ truncated: false }] })

    const oversized = await setupWave({ maxResultBytes: 1024 })
    const pending = oversized.waves.startWave(waveRequest(oversized.parent, [member()]))
    await vi.waitFor(() => { expect(oversized.provider.runs).toHaveLength(1) })
    oversized.provider.runs[0]!.deferred.resolve({
      output: [
        { type: 'text', text: 'x😀'.repeat(300) },
        { type: 'reasoning', text: 'reasoning' },
        { type: 'text', text: 'tail' },
      ],
      stopReason: 'completed',
    })
    const result = await pending
    const row = result.members[0]!
    expect(row.truncated).toBe(true)
    expect(textBytes(row)).toBeLessThanOrEqual(1024)
    expect(row.output.some(block => block.type === 'reasoning')).toBe(true)
    expect(JSON.stringify(row.output)).not.toContain('\uFFFD')
  })

  it('drops over-cap or unserializable structured values', async () => {
    const { waves, provider, parent } = await setupWave({ maxResultBytes: 1024 })
    const circular: { self?: unknown } = {}
    circular.self = circular
    const pending = waves.startWave(waveRequest(parent, [member(), member(), member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(3) })
    provider.runs[0]!.deferred.resolve(completed('first', { text: 'x'.repeat(2048) }))
    provider.runs[1]!.deferred.resolve(completed('second', circular))
    provider.runs[2]!.deferred.resolve(completed('third', { verdict: 'ok' }))
    const result = await pending
    expect(result.members[0]).toMatchObject({ truncated: true })
    expect(result.members[0]).not.toHaveProperty('structured')
    expect(result.members[1]).toMatchObject({ truncated: true })
    expect(result.members[1]).not.toHaveProperty('structured')
    expect(result.members[2]).toMatchObject({ truncated: false, structured: { verdict: 'ok' } })
  })

  it('caps mixed output where early text blocks fit fully before a cut', async () => {
    const { waves, provider, parent } = await setupWave({ maxResultBytes: 1024 })
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.deferred.resolve({
      output: [
        { type: 'text', text: 'a'.repeat(700) },
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'b'.repeat(300) },
        { type: 'text', text: 'c'.repeat(100) },
        { type: 'text', text: 'd'.repeat(50) },
      ],
      stopReason: 'completed',
    })
    const result = await pending
    const row = result.members[0]!
    expect(row.truncated).toBe(true)
    expect(textBytes(row)).toBe(1024)
    const texts = row.output.map(block => block.type === 'text' ? block.text : `reasoning:${block.type}`)
    expect(texts).toEqual(['a'.repeat(700), 'reasoning:reasoning', 'b'.repeat(300), 'c'.repeat(24), ''])
  })
})

describe('WaveRuntime remote controls and lifetime', () => {
  it('validates remote ids and maps control failures to stable gateway errors', async () => {
    const { waves, parent } = await setupWave()
    const waveId = WaveId('absent-wave')
    const memberId = WaveMemberId('absent-member')
    expect(() => waves.remoteExportList(SessionId(''))).toThrowError(expect.objectContaining({ code: 'gateway/bad-request' }))
    expect(() => waves.remoteCancelMember(WaveId(''), memberId)).toThrowError(expect.objectContaining({ code: 'gateway/bad-request' }))
    expect(() => waves.remoteCancelWave(WaveId(''))).toThrowError(expect.objectContaining({ code: 'gateway/bad-request' }))
    expect(() => waves.remoteCancelAll(SessionId(''))).toThrowError(expect.objectContaining({ code: 'gateway/bad-request' }))
    expect(() => waves.cancelWave(waveId)).toThrowError(expect.objectContaining({ code: 'WAVE_NOT_FOUND' }))
    expect(() => waves.remoteCancelWave(waveId)).toThrowError(expect.objectContaining({ code: 'wave/not-found' }))
    expect(() => waves.remoteCancelMember(waveId, memberId)).toThrowError(expect.objectContaining({ code: 'wave/not-found' }))

    const pending = waves.startWave(waveRequest(parent, [member()]))
    const view = waves.listWaves(parent.id)[0]!
    expect(() => waves.cancelMember(view.waveId, memberId)).toThrowError(expect.objectContaining({ code: 'MEMBER_NOT_FOUND' }))
    expect(() => waves.remoteCancelMember(view.waveId, memberId)).toThrowError(expect.objectContaining({
      code: 'wave/member-not-found',
      details: { waveId: String(view.waveId), memberId: String(memberId) },
    }))
    const cancel = vi.spyOn(waves, 'cancelWave').mockImplementation(() => { throw new Error('control failed') })
    expect(() => waves.remoteCancelWave(view.waveId)).toThrowError(expect.objectContaining({ code: 'gateway/internal' }))
    cancel.mockRestore()
    waves.cancelWave(view.waveId)
    await pending
  })

  it('drops retained waves when their parent disposes', async () => {
    const { ctx, waves, provider, parent } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    ctx.emit('agent/disposed', { agent: parent })
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
    expect(waves.listWaves(parent.id)).toEqual([])
  })

  it('waits for aborted children and their disposal during engine teardown', async () => {
    const { waves, provider, parent, waveFiber } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    const disposal = Promise.withResolvers<undefined>()
    provider.runs[0]!.dispose.mockImplementation(() => disposal.promise)

    const teardown = waveFiber.dispose()
    let toreDown = false
    void teardown.then(() => { toreDown = true })
    await vi.waitFor(() => { expect(provider.runs[0]!.dispose).toHaveBeenCalledOnce() })
    // The abort settles the member status, but the wave cannot close while the
    // child's disposal is still in flight — the teardown stays blocked too.
    provider.runs[0]!.deferred.resolve({ output: [], stopReason: 'aborted' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(toreDown).toBe(false)

    disposal.resolve(undefined)
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
    await teardown
    expect(toreDown).toBe(true)
  })
})

describe('WaveRuntime helper and lifetime edges', () => {
  it('truncates text to byte ceilings without splitting a code point', () => {
    expect(truncateUtf8('tail', 10)).toBe('tail')
    expect(truncateUtf8('x'.repeat(6), 5)).toBe('xxxxx')
    // An emoji whose last byte lands exactly on the cut still fits.
    expect(truncateUtf8('x😀'.repeat(2), 5)).toBe('x😀')
    // A lead byte alone at the cut cannot decode; nothing valid remains.
    expect(truncateUtf8('😀', 3)).toBe('')
    // A cut inside a code point rolls back to the start of its sequence.
    expect(truncateUtf8('xx😀', 4)).toBe('xx')
  })

  it('prunes a disposed parents waves across closed rows and foreign parents', async () => {
    const { ctx, waves, provider, parent } = await setupWave({ maxConcurrent: 1 })
    const other = fakeParent('other-parent')
    const first = waves.startWave(waveRequest(parent, [member()], { label: 'first' }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.deferred.resolve(completed('first'))
    await expect(first).resolves.toMatchObject({ outcome: 'completed' })

    const second = waves.startWave(waveRequest(parent, [member(), member()], { label: 'second' }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(2) })
    const view = waves.listWaves(parent.id).find(wave => wave.label === 'second')!
    waves.cancelMember(view.waveId, view.members[1]!.memberId)
    provider.runs[1]!.deferred.resolve(completed('second'))
    await expect(second).resolves.toMatchObject({ outcome: 'partial' })

    const third = waves.startWave(waveRequest(other, [member()], { label: 'third' }))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(3) })

    ctx.emit('agent/disposed', { agent: parent })
    expect(waves.listWaves(parent.id)).toEqual([])
    expect(waves.listWaves(other.id)).toHaveLength(1)
    provider.runs[2]!.deferred.resolve(completed('third'))
    await expect(third).resolves.toMatchObject({ outcome: 'completed' })
  })

  it('delegates pre-steps without budgets even when no meter supplies usage', async () => {
    const { ctx, waves, provider, parent } = await setupWave({}, { meter: false })
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    await expect(preStep(ctx, childAgent(provider.runs[0]!))).resolves.toEqual({ kind: 'enter', messages: [] })
    provider.runs[0]!.deferred.resolve(completed())
    await expect(pending).resolves.toMatchObject({ outcome: 'completed', members: [{ status: 'completed', tokensUsed: 0 }] })
  })

  it('settles budget-killed when an aborted child rejects instead of resolving', async () => {
    const { ctx, waves, parent } = await setupWave()
    const rejecting = new RejectionOnAbortProvider('rejection-child')
    ctx.subagents.registerProvider(rejecting)
    const pending = waves.startWave(waveRequest(parent, [member({}, { provider: rejecting.name })], { maxTokensPerMember: 10 }))
    await vi.waitFor(() => { expect(rejecting.runs).toHaveLength(1) })
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue(usage(11) as never)
    await expect(preStep(ctx, childAgent(rejecting.runs[0]!))).resolves.toEqual({ kind: 'reject' })
    await expect(pending).resolves.toMatchObject({
      outcome: 'partial',
      members: [{ status: 'budget-killed', diagnostic: 'member token budget exceeded' }],
    })
  })

  it('keeps a cancelled settlement when disposal fails after the abort', async () => {
    const { waves, provider, parent } = await setupWave()
    const pending = waves.startWave(waveRequest(parent, [member()]))
    await vi.waitFor(() => { expect(provider.runs).toHaveLength(1) })
    provider.runs[0]!.dispose.mockRejectedValue(new Error('reap failed'))
    const view = waves.listWaves(parent.id)[0]!
    waves.cancelMember(view.waveId, view.members[0]!.memberId)
    provider.runs[0]!.deferred.resolve({ output: [], stopReason: 'aborted' })
    await expect(pending).resolves.toMatchObject({
      outcome: 'cancelled',
      members: [{ status: 'cancelled', diagnostic: 'dispose failed: reap failed' }],
    })
  })
})

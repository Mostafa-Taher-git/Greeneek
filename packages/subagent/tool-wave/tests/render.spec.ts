/**
 * Pure rendering behavior: canonical report values from settled engine
 * records, structured-value sanitization, cancel scoping over retained
 * views, and the compact model-facing text of both reports.
 *
 * @module tool-wave/tests/render
 */

import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@greeneek/gnk-session'
import type { ContentBlock } from '@greeneek/gnk-llm'
import { WaveId, WaveMemberId } from '@greeneek/gnk-subagent-wave'
import type { WaveMemberResult, WaveView } from '@greeneek/gnk-subagent-wave'
import {
  cancelWaveValue,
  memberReportRow,
  renderCancelReport,
  renderWaveReport,
  sanitizeStructured,
  waveReportValue,
} from '../src/render.ts'

/** One retained wave view for cancel-scoping tests. */
function view(waveId: string, closed: boolean): WaveView {
  return {
    waveId: WaveId(waveId),
    label: 'retained fleet',
    parentSessionId: SessionId('wave-tool-parent'),
    closed,
    members: [],
  }
}

/** One settled engine member record with every optional field overridable. */
function settledMember(over: Partial<WaveMemberResult> = {}): WaveMemberResult {
  const base: WaveMemberResult = {
    memberId: WaveMemberId('w1:2'),
    provider: 'constant',
    status: 'completed',
    tokensUsed: 5,
    truncated: false,
    output: [{ type: 'text', text: 'member answer' }],
    stopReason: 'completed',
    ...over,
  }
  return base
}

/** The flattened text of one model-facing report block; any other block kind fails loud. */
function textOf(block: ContentBlock | undefined): string {
  if (block === undefined || block.type !== 'text') throw new Error('expected a report text block')
  return block.text
}

describe('waveReportValue', () => {
  it('maps a full settled member row with every optional field', () => {
    const row = memberReportRow(settledMember({
      role: 'scout',
      model: 'fast-model',
      diagnostic: 'n/a detail',
      childSessionId: SessionId('child-2'),
      truncated: true,
      structured: { keep: [1, 2] },
    }), 2)
    expect(row).toEqual({
      index: 2,
      member_id: 'w1:2',
      provider: 'constant',
      role: 'scout',
      model: 'fast-model',
      status: 'completed',
      stop_reason: 'completed',
      child_session_id: 'child-2',
      tokens_used: 5,
      diagnostic: 'n/a detail',
      truncated: true,
      output: [{ type: 'text', text: 'member answer' }],
      structured: { keep: [1, 2] },
    })
  })

  it('omits fields the engine left absent', () => {
    const row = memberReportRow(settledMember({ status: 'failed', diagnostic: 'route failed' }), 0)
    expect(row).toEqual({
      index: 0,
      member_id: 'w1:2',
      provider: 'constant',
      status: 'failed',
      stop_reason: 'completed',
      tokens_used: 5,
      diagnostic: 'route failed',
      truncated: false,
      output: [{ type: 'text', text: 'member answer' }],
    })
  })

  it('indexes rows by dispatch position and keeps the wave identity', () => {
    const report = waveReportValue({
      waveId: WaveId('wave-7'),
      outcome: 'partial',
      members: [settledMember(), settledMember({ memberId: WaveMemberId('wave-7:1'), status: 'cancelled' })],
    })
    expect(report.wave_id).toBe('wave-7')
    expect(report.outcome).toBe('partial')
    expect(report.rows.map(row => row.index)).toEqual([0, 1])
    expect(report.rows[1]?.member_id).toBe('wave-7:1')
  })
})

describe('sanitizeStructured', () => {
  it('passes lossless JSON data through unchanged and drops unrepresentable values', () => {
    const value = { keep: [1, 'two', null, false] }
    expect(sanitizeStructured(value)).toEqual(value)
    expect(sanitizeStructured(undefined)).toBeUndefined()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(sanitizeStructured(cyclic)).toBeUndefined()
  })
})

describe('cancelWaveValue', () => {
  it('cancels every open view on cancel-all and skips closed ones', () => {
    const cancel = vi.fn()
    const report = cancelWaveValue([view('w-open', false), view('w-closed', true)], undefined, cancel)
    expect(report).toEqual({
      rows: [
        { wave_id: 'w-open', outcome: 'cancelled' },
        { wave_id: 'w-closed', outcome: 'already settled' },
      ],
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(WaveId('w-open'))
  })

  it('addresses exactly one wave by id and echoes the id', () => {
    const cancel = vi.fn()
    const report = cancelWaveValue([view('w-open', false)], 'w-open', cancel)
    expect(report).toEqual({ wave_id: 'w-open', rows: [{ wave_id: 'w-open', outcome: 'cancelled' }] })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('denies a foreign id without touching the engine', () => {
    const cancel = vi.fn()
    const report = cancelWaveValue([view('w-real', false)], 'w-foreign', cancel)
    expect(report).toEqual({ wave_id: 'w-foreign', rows: [] })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('reports a closed wave addressed by id as already settled', () => {
    const cancel = vi.fn()
    const report = cancelWaveValue([view('w-closed', true)], 'w-closed', cancel)
    expect(report).toEqual({ wave_id: 'w-closed', rows: [{ wave_id: 'w-closed', outcome: 'already settled' }] })
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('renderWaveReport', () => {
  it('renders the header, the row line, every fact fragment, and the detail lines', () => {
    const [block] = renderWaveReport({
      wave_id: 'wave-1',
      outcome: 'partial',
      rows: [{
        index: 2,
        member_id: 'wave-1:2',
        provider: 'constant (u)',
        role: 'reviewer',
        status: 'failed',
        stop_reason: 'error',
        child_session_id: 'child-2',
        tokens_used: 40,
        diagnostic: 'route failed',
        truncated: true,
        output: [{ type: 'text', text: 'alpha part' }, { type: 'image', url: 'safe' }, { type: 'text', text: 'beta part' }],
        structured: { ok: 1 },
      }],
    })
    expect(textOf(block)).toEqual([
      'Wave wave-1 settled: partial, 1 member row(s).',
      '[2] constant (u) (reviewer) — failed — 40 tokens',
      '  child session child-2, stop reason error, truncated',
      '  diagnostic: route failed',
      '  structured: {"ok":1}',
      '  output: alpha partbeta part',
    ].join('\n'))
  })

  it('renders a minimal row without an empty facts or detail line', () => {
    const [block] = renderWaveReport({
      wave_id: 'wave-2',
      outcome: 'completed',
      rows: [{
        index: 0,
        member_id: 'wave-2:0',
        provider: 'constant',
        status: 'cancelled',
        tokens_used: 0,
        truncated: false,
        output: [],
      }],
    })
    expect(textOf(block)).toEqual([
      'Wave wave-2 settled: completed, 1 member row(s).',
      '[0] constant — cancelled — 0 tokens',
      '  output: ',
    ].join('\n'))
  })
})

describe('renderCancelReport', () => {
  it('denies a foreign wave id and states an empty session separately', () => {
    const denied = renderCancelReport({ wave_id: 'ghost', rows: [] })
    expect(denied).toHaveLength(1)
    expect(textOf(denied[0])).toBe('Wave ghost is not retained for this session.')
    const empty = renderCancelReport({ rows: [] })
    expect(empty).toHaveLength(1)
    expect(textOf(empty[0])).toBe('No retained waves for this session.')
  })

  it('renders one line per cancelled or settled wave', () => {
    const single = renderCancelReport({ wave_id: 'w-open', rows: [{ wave_id: 'w-open', outcome: 'cancelled' }] })
    expect(single).toHaveLength(1)
    expect(textOf(single[0])).toBe('Wave w-open cancelled.')
    const multi = renderCancelReport({
      rows: [
        { wave_id: 'w-closed', outcome: 'already settled' },
        { wave_id: 'w-open', outcome: 'cancelled' },
      ],
    })
    expect(multi).toHaveLength(1)
    expect(textOf(multi[0])).toBe('Wave w-closed already settled.\nWave w-open cancelled.')
  })
})

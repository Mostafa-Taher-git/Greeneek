/** Versioned subagent descriptor: v4 lane fields and supported v3 reads. */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@greeneek/gnk-session'
import {
  foldSubagentDescriptor, snapshotSubagentDescriptor, SUBAGENT_DESCRIPTOR_VERSION,
} from '../src/index.ts'

function event(data: unknown): SessionEvent {
  return { type: 'subagent/descriptor', seq: 1, time: 0, data } as unknown as SessionEvent
}

describe('subagent descriptors', () => {
  it('snapshots the v4 lane preset and cwd', () => {
    const descriptor = snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'spawn',
      label: 'review',
      agentPreset: 'instructor',
      cwd: '/worktrees/session/lane',
    })
    expect(descriptor).toMatchObject({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      agentPreset: 'instructor',
      cwd: '/worktrees/session/lane',
    })
  })

  it('reads a v3 descriptor without lane fields', () => {
    const folded = foldSubagentDescriptor([event({
      version: 3,
      mode: 'continuable',
      provider: 'spawn',
      label: 'legacy lane',
      agentProvider: 'mock',
    })])
    expect(folded).toMatchObject({
      version: 3,
      mode: 'continuable',
      provider: 'spawn',
      label: 'legacy lane',
      agentProvider: 'mock',
    })
    expect(folded).not.toHaveProperty('agentPreset')
    expect(folded).not.toHaveProperty('cwd')
  })

  it('rejects a v3 descriptor carrying a v4 field', () => {
    expect(() => foldSubagentDescriptor([event({
      version: 3,
      mode: 'continuable',
      provider: 'spawn',
      label: 'future field',
      agentPreset: 'instructor',
    })])).toThrow('unknown field "agentPreset"')
  })

  it('ignores an unsupported future version', () => {
    expect(foldSubagentDescriptor([event({
      version: SUBAGENT_DESCRIPTOR_VERSION + 1,
      mode: 'continuable',
      provider: 'spawn',
      label: 'future',
    })])).toBeUndefined()
  })
})

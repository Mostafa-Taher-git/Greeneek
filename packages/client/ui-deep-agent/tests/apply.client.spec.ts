// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply, inject, type DeepAgentInjected } from '../src/client/index.ts'

async function setup(): Promise<{ slots: SlotRegistry; remote: Record<string, ReturnType<typeof vi.fn>> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'deep-agent': { kind: 'single', scope: 'root' },
      'sidebar.primary.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('layout', {
    showConversation: vi.fn(),
    openDeepAgent: vi.fn(),
  })
  const remote = {
    state: vi.fn(),
    tickets: vi.fn(),
    decisions: vi.fn(),
    triggers: vi.fn(),
    databasePath: vi.fn(),
    maxWorkers: vi.fn(),
    stopTicket: vi.fn(),
    retryTicket: vi.fn(),
    decide: vi.fn().mockResolvedValue({ ok: true, value: 'decision-1' }),
  }
  ctx.provide('remote', { deepAgent: remote })
  ctx.provide('remote.deepAgent', remote)
  await ctx.plugin({ inject, apply }).await()
  return { slots, remote }
}

describe('deep-agent client', () => {
  it('registers the page and a sidebar entry ordered after Automation tasks', async () => {
    const { slots } = await setup()
    expect(slots.entries('deep-agent')).toHaveLength(1)
    const shortcut = slots.entries('sidebar.primary.action').find(item => item.options.id === 'shortcut-deep-agent')
    expect(shortcut?.options.order).toBe(-1)
  })

  it('forwards an operator decision to the deepAgent Remote', async () => {
    const { slots, remote } = await setup()
    const entry = slots.entries('deep-agent')[0]
    expect(entry?.inject).toBeTypeOf('function')
    const injected = entry?.inject?.() as DeepAgentInjected | undefined
    expect(injected?.decide).toBeTypeOf('function')
    await injected?.decide({ triggerId: 'trigger-1', accept: true, reason: 'operator approved' })
    expect(remote.decide).toHaveBeenCalledWith({
      triggerId: 'trigger-1', accept: true, reason: 'operator approved',
    })
  })
})

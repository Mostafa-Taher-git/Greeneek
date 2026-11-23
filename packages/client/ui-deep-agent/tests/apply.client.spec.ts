// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'

describe('deep-agent client', () => {
  it('registers the page and a sidebar entry ordered after Automation tasks', async () => {
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
    ctx.provide('remote', {})
    ctx.provide('remote.deepAgent', {
      state: vi.fn(),
      tickets: vi.fn(),
      decisions: vi.fn(),
      triggers: vi.fn(),
      databasePath: vi.fn(),
      maxWorkers: vi.fn(),
      stopTicket: vi.fn(),
      retryTicket: vi.fn(),
    })
    await ctx.plugin({ inject, apply }).await()
    expect(slots.entries('deep-agent')).toHaveLength(1)
    const shortcut = slots.entries('sidebar.primary.action').find(item => item.options.id === 'shortcut-deep-agent')
    expect(shortcut?.options.order).toBe(-1)
  })
})

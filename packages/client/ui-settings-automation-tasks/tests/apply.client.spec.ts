// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply, inject, type AutomationTasksInjected } from '../src/client/index.ts'

describe('automation tasks settings section', () => {
  it('surfaces a failed run Remote so the panel can show it and refresh', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'automation-tasks': { kind: 'single', scope: 'root' } } } as never, () => null)
    ctx.provide('locale', new LocaleRuntime(ctx))
    const remote = {
      list: vi.fn(async () => ({ ok: true as const, value: { tasks: [] } })),
      run: vi.fn(async () => ({ ok: false as const, error: { message: 'script exhausted' } })),
    }
    ctx.provide('remote', { automation: remote })
    ctx.provide('remote.automation', remote)
    ctx.provide('uiWorkspace', { startSession: vi.fn() })
    ctx.provide('layout', { openSettings: vi.fn(), openAutomationTasks: vi.fn(), showConversation: vi.fn() })
    ctx.provide('conversation', { seedDraft: vi.fn() })
    await ctx.plugin({ inject, apply }).await()
    const injected = slots.entries('automation-tasks')[0]?.inject?.() as AutomationTasksInjected | undefined
    expect(injected?.run).toBeTypeOf('function')
    await expect(injected?.run('task-1')).rejects.toThrow('script exhausted')
  })

  it('registers one section with the expected id and order', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry)
    // Declare the settings.section slot the section registers into.
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'automation-tasks': { kind: 'single', scope: 'root' },
        'sidebar.primary.action': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('remote', {})
    ctx.provide('remote.automation', {
      list: vi.fn(async () => ({ ok: true as const, value: { tasks: [] } })),
    })
    ctx.provide('uiWorkspace', { startSession: vi.fn() })
    ctx.provide('layout', { openSettings: vi.fn(), openAutomationTasks: vi.fn(), showConversation: vi.fn() })
    ctx.provide('conversation', { seedDraft: vi.fn() })
    await ctx.plugin({ inject, apply }).await()
    const page = slots.entries('automation-tasks')[0]
    expect(page).toBeTruthy()
    const shortcut = slots.entries('sidebar.primary.action').find(s => s.options.id === 'shortcut-automation-tasks')
    expect(shortcut).toBeTruthy()
    expect(shortcut?.options.order).toBe(-2)
  })
})

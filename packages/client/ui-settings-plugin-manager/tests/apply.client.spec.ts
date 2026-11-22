// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'

describe('plugins settings section', () => {
  it('registers one section with the expected id and order', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'plugins': { kind: 'single', scope: 'root' },
        'sidebar.primary.action': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('remote', {})
    ctx.provide('remote.pluginInventory', {
      list: vi.fn(async () => ({ ok: true as const, value: { entries: [] } })),
    })
    ctx.provide('layout', {
      selectSettingsSection: vi.fn(),
      openSettings: vi.fn(),
      openPlugins: vi.fn(),
      showConversation: vi.fn(),
    })
    ctx.provide('conversation', { seedDraft: vi.fn() })
    ctx.provide('uiWorkspace', { startSession: vi.fn() })
    await ctx.plugin({ inject, apply }).await()
    const page = slots.entries('plugins')[0]
    expect(page).toBeTruthy()
    const shortcut = slots.entries('sidebar.primary.action').find(s => s.options.id === 'shortcut-plugin-manager')
    expect(shortcut).toBeTruthy()
    expect(shortcut?.options.order).toBe(-1)
  })
})

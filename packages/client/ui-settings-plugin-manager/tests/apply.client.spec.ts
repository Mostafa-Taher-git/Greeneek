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
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('remote', {})
    ctx.provide('remote.pluginInventory', {
      list: vi.fn(async () => ({ ok: true as const, value: { entries: [] } })),
    })
    ctx.provide('layout', {
      selectSettingsSection: vi.fn(),
      openSettings: vi.fn(),
      showConversation: vi.fn(),
    })
    await ctx.plugin({ inject, apply }).await()
    const section = slots.entries('settings.section').find(s => s.options.id === 'plugin-manager')
    expect(section).toBeTruthy()
    expect(section?.options.order).toBe(17)
  })
})

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'

describe('automation tasks settings section', () => {
  it('registers one section with the expected id and order', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry)
    // Declare the settings.section slot the section registers into.
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('remote', {})
    ctx.provide('remote.automation', {
      list: vi.fn(async () => ({ ok: true as const, value: { tasks: [] } })),
    })
    ctx.provide('uiWorkspace', { startSession: vi.fn() })
    await ctx.plugin({ inject, apply }).await()
    const sections = slots.entries('settings.section')
    const section = sections.find(s => s.options.id === 'automation-tasks')
    expect(section).toBeTruthy()
    expect(section?.options.order).toBe(16)
  })
})

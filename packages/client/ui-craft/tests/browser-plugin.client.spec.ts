/**
 * ui-craft browser half on a real cordis Context with the real slot registry
 * and locale runtime: the plugin registers both dictionaries, seats the
 * `craft-suite` settings section, claims exactly the pilot artifact toolview
 * keys, injects the static fallback when no source is supplied, injects a
 * custom source verbatim, and folds everything up on fiber disposal.
 */
import { Context } from '@greeneek/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@greeneek/gnk-client-ui-slots'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import type { CraftSettingsSource } from '../src/client/contract.ts'
import type { CraftSectionInjected } from '../src/client/settings/CraftSection.tsx'
import { CraftArtifactRow } from '../src/client/artifact/CraftArtifactRow.tsx'
import { ARTIFACT_TOOL_KEYS } from '../src/client/catalog.ts'
import { CraftSection } from '../src/client/settings/CraftSection.tsx'
import { apply, inject, type CraftPluginOptions } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench(options?: CraftPluginOptions) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply: (context: Context) =>{  apply(context, options) } })
  await fiber.await()
  return { ctx, slots, locale, declare, fiber }
}

const source: CraftSettingsSource = {
  available: () => Promise.resolve([]),
  check: () => Promise.resolve({ id: 'photocraft', displayName: 'PhotoCraft', state: 'ready', launcherUrl: 'l', downloadUrl: 'd' }),
  launchConnected: () => Promise.resolve({ id: 'photocraft', displayName: 'PhotoCraft', state: 'running', launcherUrl: 'l', downloadUrl: 'd' }),
}

describe('ui-craft apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it binds', () => {
    expect(inject).toEqual(['locale', 'slots'])
  })

  it('registers both dictionaries under the craft namespace', async () => {
    const { locale, fiber } = await bench()
    const t = locale.bind('craft')
    expect(t('section.nav')).toBe('应用设置')
    expect(t('state.ready')).toBe('就绪')
    locale.setLocale('en')
    expect(t('state.ready')).toBe('Ready')
    await fiber.dispose()
  })

  it('seats the craft-suite section with the fallback source when none is injected', async () => {
    const { slots, declare, fiber } = await bench()
    declare()
    await Promise.resolve()
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(CraftSection)
    expect(entry.options).toMatchObject({ id: 'craft-suite', order: 40 })
    expect(entry.locale).toBe('craft')
    expect(resolveSlotLabel(entry.options.label)).toBe('应用设置')
    const injected = (entry.inject as unknown as () => CraftSectionInjected)()
    const rows = await injected.source.available()
    expect(rows.map(row => row.id)).toEqual(['photocraft', 'pdfcraft'])
    expect(rows.every(row => row.state === 'unavailable')).toBe(true)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })

  it('injects a supplied source verbatim', async () => {
    const { slots, declare, fiber } = await bench({ source })
    declare()
    await Promise.resolve()
    const entry = slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => CraftSectionInjected)()
    expect(injected.source).toBe(source)
    await fiber.dispose()
  })

  it('claims exactly the pilot artifact toolview keys and releases them on disposal', async () => {
    const { slots, declare, fiber } = await bench()
    declare()
    await Promise.resolve()
    const entries = slots.entries('tool.call.toolview')
    expect(entries.map(entry => entry.options.key)).toEqual([...ARTIFACT_TOOL_KEYS])
    expect(entries.map(entry => entry.component)).toEqual(ARTIFACT_TOOL_KEYS.map(() => CraftArtifactRow))
    expect(entries.map(entry => entry.locale)).toEqual(ARTIFACT_TOOL_KEYS.map(() => 'craft'))
    expect([...ARTIFACT_TOOL_KEYS]).toEqual([
      'mcp__photocraft__render_preview',
      'mcp__photocraft__screenshot',
      'mcp__pdfcraft__command_run',
      'mcp__pdfcraft__command_batch',
      'mcp__pdfcraft__render_preview',
      'mcp__pdfcraft__doc_create_multiple',
      'mcp__pdfcraft__doc_export_images',
      'mcp__pdfcraft__doc_save',
    ])
    await fiber.dispose()
    expect(slots.entries('tool.call.toolview')).toHaveLength(0)
  })
})

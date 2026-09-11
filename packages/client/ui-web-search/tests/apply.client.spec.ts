/**
 * ui-web-search apply wiring: dictionary provision, search-engine row
 * registration, snapshot projection into the row store, and face
 * write-through to the Host sections.
 */
import { Context } from '@greeneek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@greeneek/gnk-client-ui-settings/client'
import { TestRemote } from '@greeneek/gnk-client-test-runtime'
import {
  apply, inject, SETTINGS_NS,
} from '@greeneek/gnk-client-ui-web-search/client'
import type { SearchEngineRowInjected } from '@greeneek/gnk-client-ui-web-search/client'
import {
  CUSTOM_SEARCH_SETTINGS_NAMESPACE, WEB_SETTINGS_NAMESPACE,
  CustomSearchSettingsSchema, WebEngineSettingsSchema,
} from '../src/search-engine-settings.ts'
import { SearchEngineRow } from '../src/client/SearchEngineRow.tsx'
import type { createSearchEngineRowStore } from '../src/client/search-engine-store.ts'

const SLOT = 'settings.general.item'

interface SectionState {
  value: Record<string, string>
  revision: number
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const sections = new Map<string, SectionState>([
    [WEB_SETTINGS_NAMESPACE, { value: {}, revision: 0 }],
    [CUSTOM_SEARCH_SETTINGS_NAMESPACE, { value: {}, revision: 0 }],
  ])
  const snapshot = (ns: string) => {
    const state = sections.get(ns)!
    return {
      ns,
      schema: ns === WEB_SETTINGS_NAMESPACE ? WebEngineSettingsSchema.toJSON() : CustomSearchSettingsSchema.toJSON(),
      value: state.value,
      applies: 'live' as const,
      secrets: [],
      revision: state.revision,
    }
  }
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: [snapshot(WEB_SETTINGS_NAMESPACE), snapshot(CUSTOM_SEARCH_SETTINGS_NAMESPACE)],
    },
  }))
  const mutate = vi.fn(async (ns: string, ops: { op: string; path: string[]; value?: string }[]) => {
    const state = sections.get(ns)!
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'unset') {
        const { [field]: _removed, ...kept } = state.value
        void _removed
        state.value = kept
      } else state.value[field] = op.value ?? ''
    }
    state.revision += 1
    return { ok: true as const, value: snapshot(ns) }
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const registrations = new Map<string, (key: string, params?: Record<string, unknown>) => string>()
  ctx.provide('locale', {
    register: (ns: string, dicts: Record<string, Record<string, string>>) => {
      for (const dict of Object.values(dicts)) registrations.set(ns, (key: string) => dict[key] ?? key)
      return () => {}
    },
    bind: (ns: string) => (key: string) => registrations.get(ns)?.(key) ?? key,
  })
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, describe, mutate, events,
    setHostSection: (ns: string, value: Record<string, string>) => {
      sections.set(ns, { value, revision: sections.get(ns)!.revision + 1 })
    },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === SearchEngineRow)!
  const handle = entry.store as ReturnType<typeof createSearchEngineRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => SearchEngineRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-web-search apply', () => {
  it('declares the slot, locale, and settings-scope services', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('registers dictionaries and the row (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries(SLOT).find(e => e.component === SearchEngineRow)!
    expect(entry.options).toMatchObject({ id: 'search-engine', order: 1 })
    expect(entry.locale).toBe(SETTINGS_NS)

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === SearchEngineRow)).toBe(true)
  })

  it('projects scope snapshots into the row store and routes face writes back', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot()).toMatchObject({ engine: '', customBaseURL: '', customModel: '' })

    face.setEngine('google')
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(WEB_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['searchProvider'], value: 'google' },
      ], expect.anything())
    })

    face.setEngine('')
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(WEB_SETTINGS_NAMESPACE, [
        { op: 'unset', path: ['searchProvider'] },
      ], expect.anything())
    })

    expect(() => { face.setEngine('nope') }).toThrow('is not offered')
  })

  it('routes custom endpoint writes to the provider section, blanks clearing', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { face } = faceOf(b.slots)

    face.setCustom('https://x.test', 'm')
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(CUSTOM_SEARCH_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['baseURL'], value: 'https://x.test' },
      ], expect.anything())
      expect(b.mutate).toHaveBeenCalledWith(CUSTOM_SEARCH_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['model'], value: 'm' },
      ], expect.anything())
    })

    face.setCustom('', '')
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(CUSTOM_SEARCH_SETTINGS_NAMESPACE, [
        { op: 'unset', path: ['baseURL'] },
      ], expect.anything())
      expect(b.mutate).toHaveBeenCalledWith(CUSTOM_SEARCH_SETTINGS_NAMESPACE, [
        { op: 'unset', path: ['model'] },
      ], expect.anything())
    })
  })

  it('adopts Host-side section changes into the row store', async () => {
    const b = await bench()
    b.setHostSection(WEB_SETTINGS_NAMESPACE, { searchProvider: 'duckduckgo' })
    b.setHostSection(CUSTOM_SEARCH_SETTINGS_NAMESPACE, { baseURL: 'https://x.test', model: 'm' })
    b.events.emit('settings/document-updated', [WEB_SETTINGS_NAMESPACE, 1])
    b.events.emit('settings/document-updated', [CUSTOM_SEARCH_SETTINGS_NAMESPACE, 1])
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance } = faceOf(b.slots)
    await vi.waitFor(() => {
      expect(instance.getSnapshot()).toMatchObject({
        engine: 'duckduckgo',
        customBaseURL: 'https://x.test',
        customModel: 'm',
      })
    })
  })
})

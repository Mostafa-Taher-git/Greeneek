/** Plugins settings section registration. */

import type {} from '@greeneek/gnk-client-locale/client'
import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-ui-settings/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type {} from '@greeneek/gnk-api-remotes/client'
import type {} from '@greeneek/gnk-client-ui-layout/client'
import {
  PluginManagerSection, type PluginManagerInjected, type PluginEntryView,
} from './PluginManagerSection.tsx'
import { ar, en, zh, type PluginManagerLocaleKey } from './locales.ts'

export type {
  PluginManagerInjected, PluginManagerSectionProps, PluginEntryView,
} from './PluginManagerSection.tsx'
export type { PluginManagerLocaleKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins settings copy. */
    'settings.pluginManager': PluginManagerLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.pluginManager'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'layout']

/** Register the section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'plugin-manager: dictionaries')

  const injected = (): PluginManagerInjected => ({
    list: async () => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
      const entries: readonly PluginEntryView[] = result.value.entries.map(entry => ({
        moduleName: entry.moduleName,
        enabled: entry.enabled,
      }))
      return entries
    },
    openBuiltIn: () => {
      ctx.layout.selectSettingsSection('plugins')
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugin-manager',
    order: 17,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: injected,
  }, PluginManagerSection))
}

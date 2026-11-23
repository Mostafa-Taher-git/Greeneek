/** Plugins settings section registration. */

import type {} from '@greeneek/gnk-client-locale/client'
import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-ui-settings/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type {} from '@greeneek/gnk-api-remotes/client'
import type {} from '@greeneek/gnk-client-ui-layout/client'
// Type-only: merges `ctx.conversation` for composer seeding.
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import type {} from '@greeneek/gnk-client-ui-workspace/client'
import {
  PluginManagerSection, type PluginManagerInjected, type PluginEntryView,
} from './PluginManagerSection.tsx'
import { SidebarAction } from './SidebarAction.tsx'
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
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'layout', 'conversation', 'uiWorkspace']

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
    createWithAgent: () => {
      ctx.layout.showConversation()
      ctx.uiWorkspace.startSession(undefined, (sessionId) => {
        ctx.conversation.seedDraft(String(sessionId), 'Please create a GNK plugin based on the requirements.')
      })
    },
    close: () => { ctx.layout.showConversation() },
  })

  ctx.slots.register({
    name: 'plugins',
    locale: NS,
    inject: injected,
  }, PluginManagerSection)

  // The shortcut sits above the Dashboard (order 0) in the primary actions.
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'shortcut-plugin-manager',
    order: -3,
    locale: NS,
    inject: () => ({ open: () => { ctx.layout.openPlugins() } }),
  }, SidebarAction))
}

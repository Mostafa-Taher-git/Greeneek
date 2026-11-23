/** Deep-agent standalone page and sidebar entry registration. */

import type {} from '@greeneek/gnk-client-locale/client'
import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-ui-layout/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
// Type-only: merges the generated `ctx.remote.deepAgent` namespace.
import type {} from '@greeneek/gnk-deep-agent-runtime/remote'
import { DeepAgentPage, type DeepAgentInjected } from './DeepAgentPage.tsx'
import { SidebarAction } from './SidebarAction.tsx'
import { ar, en, zh, type DeepAgentLocaleKey } from './locales.ts'

export type {
  DeepAgentInjected, DeepAgentPageProps, StateView, TicketView, DecisionView, TriggerView,
} from './DeepAgentPage.tsx'
export type { DeepAgentLocaleKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Deep-agent management copy. */
    deepAgent: DeepAgentLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'deepAgent'

/** Required services. */
export const inject = ['slots', 'locale', 'layout', 'remote', 'remote.deepAgent']

/** Unwrap a Remote result or throw on failure. */
function unwrap<T>(result:
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Register the page and its sidebar entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'deep-agent: dictionaries')

  const injected = (): DeepAgentInjected => ({
    state: async () => unwrap(await ctx.remote.deepAgent.state()),
    tickets: async () => unwrap(await ctx.remote.deepAgent.tickets()),
    decisions: async () => unwrap(await ctx.remote.deepAgent.decisions()),
    triggers: async () => unwrap(await ctx.remote.deepAgent.triggers()),
    databasePath: async () => unwrap(await ctx.remote.deepAgent.databasePath()),
    maxWorkers: async () => unwrap(await ctx.remote.deepAgent.maxWorkers()),
    stop: async (ticketId) => { unwrap(await ctx.remote.deepAgent.stopTicket({ ticketId })) },
    retry: async (ticketId) => { unwrap(await ctx.remote.deepAgent.retryTicket({ ticketId })) },
    settings: async () => unwrap(await ctx.remote.deepAgent.settings()),
    saveSettings: async (block, value, revision) => unwrap(await ctx.remote.deepAgent.saveSettings({ block, value, revision })),
    prompts: async () => unwrap(await ctx.remote.deepAgent.prompts()),
    promptHistory: async name => unwrap(await ctx.remote.deepAgent.promptHistory({ name })),
    savePrompt: async (name, text) => unwrap(await ctx.remote.deepAgent.savePrompt({ name, text })),
    resetPrompt: async request => unwrap(await ctx.remote.deepAgent.resetPrompt(request)),
    close: () => { ctx.layout.showConversation() },
  })

  ctx.slots.register({ name: 'deep-agent', locale: NS, inject: injected }, DeepAgentPage)

  // New Session, Plugins (-3), Automation tasks (-2), Deep-agent (-1), Workspaces.
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'shortcut-deep-agent',
    order: -1,
    locale: NS,
    inject: () => ({ open: () => { ctx.layout.openDeepAgent() } }),
  }, SidebarAction))
}

/** Automation tasks settings section registration. */

import type {} from '@greeneek/gnk-client-locale/client'
import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-ui-settings/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type {} from '@greeneek/gnk-api-remotes/client'
// Type-only: merges the generated `ctx.remote.automation` namespace.
import type {} from '@greeneek/gnk-automation/remote'
import type {} from '@greeneek/gnk-client-ui-workspace/client'
import type {} from '@greeneek/gnk-client-ui-layout/client'
import {
  AutomationTasksSection, type AutomationTasksInjected, type AutomationTaskView,
} from './AutomationTasksSection.tsx'
import { SidebarAction } from './SidebarAction.tsx'
import { ar, en, zh, type AutomationTasksLocaleKey } from './locales.ts'

export type {
  AutomationTasksInjected, AutomationTasksSectionProps, AutomationTaskView,
} from './AutomationTasksSection.tsx'
export type { AutomationTasksLocaleKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation tasks settings copy. */
    'settings.automationTasks': AutomationTasksLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.automationTasks'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.automation', 'uiWorkspace', 'layout']

/** Map a wire task to the UI view. */
function toView(value: {
  id: string
  title: string
  prompt: string
  status: 'active' | 'paused' | 'ended'
  timing: {
    repeat: 'once' | 'hourly' | 'daily' | 'weekly'
    at: string | null
    timeZone: string
  }
  lastRunAt: string | null
  updatedAt: string
}): AutomationTaskView {
  return {
    id: value.id, title: value.title, prompt: value.prompt, status: value.status,
    repeat: value.timing.repeat, at: value.timing.at, timeZone: value.timing.timeZone,
    lastRunAt: value.lastRunAt, updatedAt: value.updatedAt,
  }
}

/** Register the section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'automation-tasks: dictionaries')

  const injected = (): AutomationTasksInjected => ({
    list: async () => {
      const result = await ctx.remote.automation.list()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.tasks.map(toView)
    },
    create: async (request) => {
      const result = await ctx.remote.automation.create(request)
      if (!result.ok) throw new Error(result.error.message)
    },
    edit: async (id, status, expectedUpdatedAt) => {
      const result = await ctx.remote.automation.edit({ id, status, expectedUpdatedAt })
      if (!result.ok) throw new Error(result.error.message)
    },
    run: async (id) => {
      const result = await ctx.remote.automation.run({ id })
      if (!result.ok) throw new Error(result.error.message)
    },
    delete: async (id) => {
      const result = await ctx.remote.automation.delete({ id })
      if (!result.ok) throw new Error(result.error.message)
    },
    createInSession: () => {
      ctx.uiWorkspace.startSession(undefined)
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'automation-tasks',
    order: 16,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: injected,
  }, AutomationTasksSection))

  // The shortcut sits above the Dashboard (order 0) in the primary actions.
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'shortcut-automation-tasks',
    order: -2,
    locale: NS,
    inject: () => ({ open: () => { ctx.layout.openSettings('automation-tasks') } }),
  }, SidebarAction))
}

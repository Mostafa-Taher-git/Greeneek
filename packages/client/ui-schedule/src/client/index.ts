/** Browser half of the read-only Schedule catalog. */

import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-locale/client'
import type {} from '@greeneek/gnk-client-ui-workspace/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type {} from '@greeneek/gnk-client-ui-session/client'
import type {} from '@greeneek/gnk-schedule/client'
import { ScheduleCatalogAction } from './ScheduleCatalogAction.tsx'
import { ar, en, NS, zh, type ScheduleCatalogKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only active Schedule catalog copy. */
    'schedule.catalog': ScheduleCatalogKey
  }
}

/** Required services for locale registration and Thread Details contribution. */
export const inject = ['slots', 'locale']

/** Register the dictionaries and Thread Details catalog action. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'ui-schedule: dictionaries')
  ctx.slots.inject(
    'conversation.details.thread.action',
    () => ctx.slots.register({
      name: 'conversation.details.thread.action',
      id: 'schedule-catalog',
      // Static Session identity precedes this entry; background jobs follow it.
      order: 10,
      locale: NS,
    }, ScheduleCatalogAction),
  )
}

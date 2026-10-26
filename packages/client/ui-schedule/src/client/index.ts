/** Browser half of the read-only Schedule catalog. */

import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-locale/client'
import type {} from '@greeneek/gnk-client-ui-conversation/client'
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

/** Required services for locale registration and header-slot contribution. */
export const inject = ['slots', 'locale']

/** Register the dictionaries and Session-header catalog action. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'ui-schedule: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'schedule-catalog',
      // Static Session identity precedes this entry; background jobs follow it.
      order: 10,
      locale: NS,
    }, ScheduleCatalogAction),
  )
}

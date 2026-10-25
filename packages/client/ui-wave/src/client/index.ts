/**
 * Army fleet surfaces, browser half: the details-panel Fleet tab and the
 * composer pill, both reading one sampled mirror of the Lead session's waves
 * through the `waves` Remote.
 * @module @greeneek/gnk-client-ui-wave/client
 */
import type { Context as ClientContext } from '@greeneek/cordis'
import type { SessionId } from '@greeneek/gnk-session/types'
// Type-only: pulls the context with the `waves` Remote namespace.
import type {} from '@greeneek/gnk-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@greeneek/gnk-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@greeneek/gnk-client-ui-renderer/client'
// Type-only: pulls the Session Controller client merge (ctx.sessions).
import type {} from '@greeneek/gnk-api-session-controller/client'
// Type-only: pulls the SlotMap merges for the two seats this plugin fills.
import type {} from '@greeneek/gnk-client-ui-chat/client'
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import type {} from '@greeneek/gnk-client-ui-session/client'
import type { FleetInjected } from './contract.ts'
import { FleetMirror } from './fleet-mirror.ts'
import { FleetPanel } from './FleetPanel.tsx'
import { FleetPill } from './FleetPill.tsx'
import { en, NS, zh, type FleetKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fleet panel, pill, and stop affordance copy. */
    fleet: FleetKey
  }
}

export type {
  FleetInjected, FleetPillProps, FleetPanelProps, FleetSnapshot, StopAllOutcome, StopOutcome,
} from './contract.ts'
export type { FleetKey } from './locales.ts'

/** Required services: the slots this plugin fills, the sampled Remote, and the copy. */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.waves']

/**
 * Client plugin body: register the dictionaries, the details-panel Fleet body,
 * and the composer pill.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-wave: dictionaries')

  // One mirror per Lead session: the tab and the pill read the same sampled
  // fleet, and its sampling loop runs while either of them is on screen.
  const mirrors = new Map<SessionId, FleetMirror>()
  const mirrorFor = (sessionId: SessionId): FleetMirror => {
    let mirror = mirrors.get(sessionId)
    if (mirror === undefined) {
      mirror = new FleetMirror(ctx, sessionId)
      mirrors.set(sessionId, mirror)
    }
    return mirror
  }

  const injected = (sessionId: SessionId): FleetInjected => {
    const mirror = mirrorFor(sessionId)
    return {
      hooks: { fleet: mirror },
      refresh: () => { mirror.refresh() },
      stopAll: () => mirror.stopAll(),
      stopWave: waveId => mirror.stopWave(waveId),
      stopMember: (waveId, memberId) => mirror.stopMember(waveId, memberId),
      // A wave member is a one-shot child: its transcript opens read-only, which
      // is the transport the subagent surface already owns.
      openChild: (childSessionId) => {
        ctx.sessions.openSubagent({ parentSessionId: sessionId, childSessionId, mode: 'one-shot' })
      },
    }
  }

  ctx.effect(() => () => {
    for (const mirror of mirrors.values()) mirror.dispose()
    mirrors.clear()
  }, 'ui-wave: fleet mirrors')

  ctx.slots.inject('conversation.details.fleet', () => ctx.slots.register({
    name: 'conversation.details.fleet',
    locale: NS,
    inject: injected,
  }, FleetPanel))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'army-fleet',
    order: 0,
    locale: NS,
    inject: injected,
  }, FleetPill))
}

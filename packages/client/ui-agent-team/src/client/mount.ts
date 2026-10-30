/** Source-safe Agent Teams browser registration and Remote mount lifecycle. */

import type {
  FleetSettings,
  TeamMemberView as TeamRosterMember,
  TeamView,
} from '@greeneek/gnk-agent-team/client'
import type {} from '@greeneek/gnk-agent-team/remote'
import type { Context as ClientContext } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-api-remotes/client'
import type {} from '@greeneek/gnk-api-session-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import type {} from '@greeneek/gnk-client-ui-settings/client'
import type {} from '@greeneek/gnk-client-locale/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@greeneek/gnk-typert-protocol'
import {
  TeamAction, type TeamActionInjected, type TeamActionResult, type TeamTaskActionResult,
} from './TeamAction.tsx'
import {
  decodeFleetSettings, FleetSettingsSection, type FleetSettingsInjected, type FleetSnapshot,
} from './FleetSettingsSection.tsx'
import { ar, en, NS, zh, type TeamKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Required browser services for RPC, navigation, slots, and localized copy. */
export const inject = ['sessions', 'remote', 'slots', 'locale', 'settingsScope']

function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'client-ui-agent-team: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.sessions
  const leadSessionId = (sessionId: SessionId): SessionId => {
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }

  const actions: TeamActionInjected = {
    async load(sessionId): Promise<TeamActionResult<TeamView>> {
      return await ctx.remote.agentTeams.view(leadSessionId(sessionId))
    },
    async createTask(sessionId, input): Promise<TeamTaskActionResult> {
      return await ctx.remote.agentTeams.createTask(leadSessionId(sessionId), input)
    },
    async updateTask(sessionId, input) {
      const { owner, ...rest } = input
      return await ctx.remote.agentTeams.updateTask(leadSessionId(sessionId), {
        ...rest,
        ...owner === undefined ? {} : { owner },
      })
    },
    async openTeammate(sessionId: SessionId, member: TeamRosterMember): Promise<void> {
      if (member.role !== 'teammate') return
      const parentSessionId = leadSessionId(sessionId)
      await sessions.refreshSubagents(parentSessionId)
      if (sessions.list.getSnapshot().current !== sessionId) return
      sessions.openSubagent({
        parentSessionId,
        childSessionId: member.id,
        mode: 'continuable',
      })
    },
  }

  const fleetScope = ctx.settingsScope.bind<FleetSettings>({
    namespace: 'fleet',
    decode: decodeFleetSettings,
  })
  // `useSyncExternalStore` requires `getSnapshot` to return a stable value between
  // changes; the scope snapshot is stable, but each derived object literal is not,
  // so memoize against the last source snapshot to avoid an infinite render loop.
  let cachedSource: ReturnType<typeof fleetScope.getSnapshot> | undefined
  let cachedSnapshot: FleetSnapshot | undefined
  const fleetSnapshot = (): FleetSnapshot => {
    const snapshot = fleetScope.getSnapshot()
    if (cachedSnapshot !== undefined && snapshot === cachedSource) return cachedSnapshot
    cachedSource = snapshot
    cachedSnapshot = {
      status: snapshot.status,
      value: snapshot.value,
      revision: snapshot.revision,
      writable: snapshot.writable,
    }
    return cachedSnapshot
  }
  const fleet: FleetSettingsInjected = {
    subscribe: listener => fleetScope.subscribe(listener),
    getSnapshot: fleetSnapshot,
    async loadAvailability() {
      return await ctx.remote.agentTeams.fleetAvailability()
    },
    async save(favorites) {
      await fleetScope.set('favorites', [...favorites])
    },
    async launch(favoriteId) {
      const current = sessions.list.getSnapshot().current
      if (current === undefined) throw new Error('Open a session before launching a fleet.')
      return await ctx.remote.agentTeams.launchFleetFavorite(leadSessionId(current), favoriteId, true)
    },
    canLaunch: () => sessions.list.getSnapshot().current !== undefined,
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'fleet',
    order: 25,
    label: () => t('fleet.title'),
    locale: NS,
    inject: () => fleet,
  }, FleetSettingsSection))

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: 20,
      locale: NS,
      inject: () => actions,
    }, TeamAction),
  )
}

/**
 * Mount one generated Team Remote contribution, then register its browser UI.
 * @param ctx - Client Context carrying navigation, locale, slot, and Remote services.
 * @param contribution - generated Team descriptors selected by the browser entry.
 * @returns disposer for both the UI registrations and Remote namespace.
 */
export async function mountAgentTeamUi(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['sessions', 'remote.agentTeams', 'slots', 'locale'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

/**
 * Command UI plugin, browser half: CommandUiRuntime (`ctx.commandUi`) owning the
 * capability-keyed directory cache, the '/' command source, the client
 * contribution registry, and the per-session popupSelect controllers; the
 * popupSelect shell self-registers into conversation.input.overlay with
 * per-session resolution.
 */
import type { Context as ClientContext } from '@greeneek/cordis'
import type { ISessions } from '@greeneek/gnk-api-session-controller/client'
// Type-only: pulls the 'conversation.input.overlay' SlotMap declaration (the
// key's owner) into this program so the overlay registration below typechecks
// against the real declaration — no runtime edge to ui-conversation.
import type {} from '@greeneek/gnk-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@greeneek/gnk-client-locale/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type {} from '@greeneek/gnk-client-ui-session/client'
// Type-only: pulls the settings.section SlotMap merge (the Commands section's
// seat) into the program — no runtime edge to ui-settings.
import type {} from '@greeneek/gnk-client-ui-settings/client'
import { CommandUiRuntime } from './service.ts'
import type { PopupSelectInjected } from './PopupSelectView.tsx'
import { PopupSelectView } from './PopupSelectView.tsx'
import type { CommandsSectionInjected } from './CommandsSection.tsx'
import { CommandsSection } from './CommandsSection.tsx'
import { en, zh, type CommandKey } from './locales.ts'

export { CommandUiRuntime } from './service.ts'
export { CommandDirectory } from './directory.ts'
export type { CommandDescriptor, DirectoryStatus } from './directory.ts'
export { filterOptions, PopupSelectController } from './popup.ts'
export type { PopupSelectDeps, PopupSpec, PopupState, TokenSegment } from './popup.ts'
export type { PopupSelectInjected, PopupSelectViewProps } from './PopupSelectView.tsx'
export type { CommandsSectionInjected, CommandsSectionProps } from './CommandsSection.tsx'
export type {
  CommandContribution, CommandDecoration, CommandUiContract, CommandUiSpec, SelectConfirmation, SelectOption,
} from './contract.ts'
export type { CommandKey } from './locales.ts'

declare module '@greeneek/cordis' {
  interface Context {
    commandUi: CommandUiRuntime
  }
}

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The popupSelect shell's copy. */
    command: CommandKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'command'

/** Required services: the '/' source registry, session scopes, commands Remote, locale registry, and the slot ledger. */
export const inject = ['inputTriggers', 'sessions', 'remote', 'remote.commands', 'locale', 'slots']

/**
 * Client plugin body: mount the service, then register the popupSelect shell
 * into the input overlay once its declarer is up.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-commands: dictionaries')
  ctx.plugin(CommandUiRuntime)
  const t = ctx.locale.bind(NS)
  const listCommands: CommandsSectionInjected['listCommands'] = async (sessionId) => {
    const result = await ctx.remote.commands.list(sessionId)
    if (!result.ok) {
      throw new Error(`command.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'commands',
    order: 20,
    label: () => t('section.nav'),
    locale: NS,
    inject: (): CommandsSectionInjected => ({ listCommands }),
  }, CommandsSection))
  ctx.inject(['slots', 'commandUi', 'sessions'], (scope: ClientContext) => {
    const command = scope.commandUi
    const sessions = scope.get('sessions') as ISessions
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay',
      id: 'command-popup',
      order: 1,
      locale: NS,
      inject: (sessionId): PopupSelectInjected => {
        const actx = sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`ui-commands: session "${String(sessionId)}" resolved no scope`)
        return { popup: command.popupFor(actx) }
      },
    }, PopupSelectView))
  })
}

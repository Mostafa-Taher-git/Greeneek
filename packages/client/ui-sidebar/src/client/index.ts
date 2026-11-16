/** Registers the sidebar shell into the layout-owned slot. */
import type { Context as ClientContext } from '@greeneek/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@greeneek/gnk-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@greeneek/gnk-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@greeneek/gnk-client-ui-session/client'
// Type-only: pulls the uiConversation service merge (ctx.uiConversation).
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import type { SidebarRootInjected, SurfacePanelInjected, TitlebarInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { SurfacePanel } from './SurfacePanel.tsx'
import { Titlebar } from './Titlebar.tsx'
import { ar, en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
  SurfacePanelComponentProps, SurfacePanelInjected, TitlebarComponentProps, TitlebarInjected,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar shell controls copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar'

/** Conversation view id of the transcript target that ui-chat registers. */
const CHAT_VIEW = 'chat'

/** Conversation view id of the request/step target that ui-trajectory registers. */
const TRAJECTORY_VIEW = 'trajectory'

interface WorkspaceNavigation {
  startSession(workspaceId?: Parameters<SidebarRootInjected['startSession']>[0]): void
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'uiConversation', 'locale']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'ui-sidebar: dictionaries')

  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Session button rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace). Starting is a
    // navigation intent, so a full-page destination yields first.
    startSession: (workspaceId) => {
      ctx.layout.showConversation()
      workspaceNavigation.startSession(workspaceId)
    },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
  })
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // The shell owns geometry; ui-workspace registers the whole browsing
      // region (header, search, session list, workspace dialogs), ui-settings
      // registers the foot trigger + settings panel.
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.primary.action': { kind: 'list', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot),
    'ui-sidebar: slot registration',
  )
  ctx.effect(
    () => ctx.slots.register({
      name: 'titlebar',
      locale: NS,
      inject: (): TitlebarInjected => ({
        // The title beside the brand is the way back to this Session's
        // transcript from Settings, the Dashboard, or any other view.
        openChat: (sessionId) => {
          ctx.layout.showConversation()
          ctx.uiConversation.selectView(sessionId, CHAT_VIEW)
        },
        // The leading toggles duplicate the sidebar controls so both stay
        // reachable when the sidebar is fully closed.
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
        startSession: () => {
          ctx.layout.showConversation()
          workspaceNavigation.startSession()
        },
      }),
    }, Titlebar),
    'ui-sidebar: titlebar registration',
  )
  ctx.effect(
    () => ctx.slots.register({
      name: 'rightbar',
      locale: NS,
      inject: (): SurfacePanelInjected => ({
        openTerminal: () => { ctx.layout.openTerminalDrawer() },
        openTrajectory: (sessionId) => {
          ctx.layout.showConversation()
          ctx.uiConversation.selectView(sessionId, TRAJECTORY_VIEW)
        },
        openChat: (sessionId) => {
          ctx.layout.showConversation()
          ctx.uiConversation.selectView(sessionId, CHAT_VIEW)
        },
        openSettings: () => { ctx.layout.openSettings() },
        openDashboard: () => { ctx.layout.openDashboard() },
      }),
    }, SurfacePanel),
    'ui-sidebar: right panel registration',
  )
}

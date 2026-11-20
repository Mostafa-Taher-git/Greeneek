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
// Type-only: pulls the Remote namespace merges (ctx.remote, ctx.remote.session).
import type {} from '@greeneek/gnk-api-remotes/client'
import type {} from '@greeneek/gnk-api-session-controller/client'
// Type-only: pulls the generated `ctx.remote.files` namespace merge.
import type {} from '@greeneek/gnk-api-workspace-controller/client'
import type {
  DeviceAppEntry, DeviceFacts, DiffView, FileListing, FileRead, GithubStatus, PullRequestRequest,
} from './surfaces/contract.ts'
import type { SidebarRootInjected, SurfacePanelInjected, TitlebarInjected } from './contract/slots.ts'
import { createRightPanelStore } from './right-panel-store.ts'
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
export const inject = [
  'slots', 'layout', 'uiWorkspace', 'uiConversation', 'locale', 'remote', 'remote.session', 'remote.files', 'remote.github', 'remote.browser', 'sessions',
]

/** Side-thread navigation over the Client Session service. */
interface SideSessionNavigation {
  open: (sessionId: never) => void
}

/** Product names for the application ids the Host reports. */
const APP_LABELS: Record<string, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  'android-studio': 'Android Studio',
  'github-desktop': 'GitHub Desktop',
}

/** Report one Host-tracked browser surface through the Remote. */
async function browserState(profile: string, ctx: ClientContext) {
  const result = await ctx.remote.browser.state({ profile: profile })
  if (!result.ok) throw new Error(result.error.message)
  const value = result.value
  return {
    profile: value.profile,
    url: value.url ?? undefined,
    status: value.status,
    titleSource: value.titleSource,
    source: value.source,
  }
}

/** Navigate one browser profile through the Host so agent and user writes agree. */
async function browserNavigate(profile: string, url: string, ctx: ClientContext): Promise<void> {
  const result = await ctx.remote.browser.navigate({ profile: profile, url })
  if (!result.ok) throw new Error(result.error.message)
}

/** Close one browser profile through the Host. */
async function browserClose(profile: string, ctx: ClientContext): Promise<void> {
  const result = await ctx.remote.browser.close({ profile: profile })
  if (!result.ok) throw new Error(result.error.message)
}

/** List one Host directory level through the file-browsing Remote. */
async function browseFiles(path: string | undefined, ctx: ClientContext): Promise<FileListing> {
  const result = await ctx.remote.files.list(path)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Read one Host text file through the file-browsing Remote. */
async function readHostFile(path: string, ctx: ClientContext): Promise<FileRead> {
  const result = await ctx.remote.files.read(path)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Report the GitHub integration's configuration without exposing the token. */
async function githubStatus(ctx: ClientContext): Promise<GithubStatus> {
  const result = await ctx.remote.github.status()
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Resolve the GitHub repository from a Workspace's origin remote. */
async function githubRepository(path: string, ctx: ClientContext): Promise<{ owner: string; repo: string }> {
  const result = await ctx.remote.github.repository({ path })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Load one page of PRs through the Host GitHub integration. */
async function githubPullRequests(request: PullRequestRequest, ctx: ClientContext) {
  const result = request.branch === undefined
    ? await ctx.remote.github.pullRequests({
      owner: request.owner, repo: request.repo, page: request.page, perPage: request.perPage,
    })
    : await ctx.remote.github.linkedPullRequests({
      owner: request.owner, repo: request.repo, branch: request.branch,
      page: request.page, perPage: request.perPage,
    })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Resolve the current branch of a Workspace through the git-facts Remote. */
async function currentBranch(path: string, ctx: ClientContext): Promise<string | undefined> {
  const result = await ctx.remote.session.gitFacts({ path })
  return result.ok ? result.value.branch : undefined
}

/** Load the unified git diff through the Session Remote. */
async function loadDiff(path: string, ctx: ClientContext): Promise<DiffView> {
  const result = await ctx.remote.session.gitDiff({ path })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Load the Host facts shown by the Device surface. */
async function loadDevice(ctx: ClientContext): Promise<DeviceFacts> {
  const host = ctx.remote.$host
  const apps: DeviceAppEntry[] = []
  let platform = ''
  const result = await ctx.remote.session.externalApps()
  if (result.ok) {
    platform = result.value.platform
    for (const app of result.value.apps) {
      if (!app.available) continue
      const label = APP_LABELS[app.id]
      if (label !== undefined) apps.push({ id: app.id, label })
    }
  }
  return {
    hostname: host.hostname,
    home: host.home,
    isLoopback: host.isLoopback,
    platform,
    apps,
  }
}

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  const sideSessions = ctx.get('sessions') as unknown as SideSessionNavigation
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
      store: createRightPanelStore,
      inject: (): SurfacePanelInjected => ({
        loadDevice: () => loadDevice(ctx),
        browseFiles: path => browseFiles(path, ctx),
        readFile: path => readHostFile(path, ctx),
        loadDiff: path => loadDiff(path, ctx),
        githubStatus: () => githubStatus(ctx),
        githubRepository: path => githubRepository(path, ctx),
        githubPullRequests: request => githubPullRequests(request, ctx),
        githubLinkedPullRequests: request => githubPullRequests(request, ctx),
        githubDetail: async (request) => {
          const result = await ctx.remote.github.pullRequestDetail(request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        githubAction: async (request) => {
          const result = await ctx.remote.github.pullRequestAction(request)
          if (!result.ok) throw new Error(result.error.message)
        },
        browserState: profile => browserState(profile, ctx),
        browserNavigate: (profile, url) => browserNavigate(profile, url, ctx),
        browserClose: profile => browserClose(profile, ctx),
        subscribeBrowser: listener => ctx.remote.$on('browser/surface', (state) => {
          listener({
            profile: state.profile,
            url: state.url,
            status: state.status,
            titleSource: state.titleSource,
            source: state.source,
          })
        }),
        openExternal: (url) => {
          try {
            const parsed = new URL(url)
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              window.open(parsed.href, '_blank', 'noopener,noreferrer')
            }
          } catch { /* ignore malformed external URLs */ }
        },
        currentBranch: path => currentBranch(path, ctx),
        forkSideChat: async (sessionId) => {
          const result = await ctx.remote.session.fork({ sessionId })
          if (!result.ok) throw new Error(result.error.message)
          return result.value.sessionId
        },
        openSideChat: (sessionId) => {
          ctx.layout.showConversation()
          sideSessions.open(sessionId as never)
        },
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

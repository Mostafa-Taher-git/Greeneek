/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns column geometry (fold state machine, brand row, New Session);
 * everything between the section header and the list bottom is the
 * `sidebar.workspaces` registrant's (ui-workspace), and the foot is the
 * `sidebar.settings` registrant's (ui-settings), followed by optional footer
 * actions in `sidebar.footer.action`; primary actions sit directly under the
 * New Session control in `sidebar.primary.action`.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { WorkspaceId } from '@greeneek/gnk-api-workspace-controller/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) into every
// program that sees this contract, so PropsRuntime<'sidebar'> resolves.
import type {} from '@greeneek/gnk-client-ui-layout/client'

declare module '@greeneek/gnk-client-ui-slots' {
  interface SlotMap {
    /**
     * Brand mark rendered in the expanded brand row and collapsed rail.
     * Declared by this package's `sidebar` entry; deployments may replace
     * the shell's fish fallback without replacing the surrounding controls.
     */
    'sidebar.brand.mark': { kind: 'single'; scope: 'root'; owner: SidebarBrandMarkOwnerProps }
    /**
     * Brand name rendered beside the expanded mark. Declared by this
     * package's `sidebar` entry; the shell supplies a generic text fallback.
     */
    'sidebar.brand.name': { kind: 'single'; scope: 'root'; owner: SidebarBrandNameOwnerProps }
    /**
     * The workspace/session browsing region: section header, search, the
     * grouped/flat session list, and every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions directly under New Session, above the browsing region.
     * Declared by this package's 'sidebar' entry; each action receives the
     * column display state and renders its own wide/rail form.
     */
    'sidebar.primary.action': { kind: 'list'; scope: 'root'; owner: SidebarPrimaryActionOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

/** Owner share of a primary action under New Session. */
export interface SidebarPrimaryActionOwnerProps {
  /** Shell fold-state output: wide renders the labelled row, rail the icon control. */
  wide: boolean
}

/** Geometry supplied to the sidebar brand-mark occupant. */
export interface SidebarBrandMarkOwnerProps {
  /** Requested square edge in pixels. */
  size: number
}

/**
 * Brand-name text supplied to the sidebar brand-name occupant.
 *
 * The sidebar owns the localized name through its own dictionary, so an
 * occupant renders the text it is given rather than embedding a product word
 * that no locale owns.
 */
export interface SidebarBrandNameOwnerProps {
  /** The localized brand name to render. */
  wordmark: string
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row must render against (wide row vs rail icon).
 */
export interface SidebarSettingsOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The shell keeps only its own controls: starting a Session from
 * the New Session button and toggling the column.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace, then the
   * recent Workspace, or clear into the New Session pure view when none exist.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/**
 * Full component props: layout owner state/actions plus the declared holes'
 * render shares, this package's injected callbacks, and the standard locale
 * seat. No store is registered.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    | 'sidebar.brand.mark'
    | 'sidebar.brand.name'
    | 'sidebar.workspaces'
    | 'sidebar.settings'
    | 'sidebar.primary.action'
    | 'sidebar.footer.action'
  >
  & SidebarRootInjected & PropsLocale<'sidebar'>

/**
 * Injected callbacks for the layout-owned `titlebar` slot: only the toggle
 * (the bar has no other controls — window controls are desktop-injected).
 */
export type TitlebarInjected = {
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/**
 * Full titlebar props: the layout owner share (collapsed flag), this
 * package's injected toggle, and the standard locale seat. No store is
 * registered and no holes are declared.
 */
export type TitlebarComponentProps =
  PropsRuntime<'titlebar'>
  & TitlebarInjected & PropsLocale<'sidebar'>

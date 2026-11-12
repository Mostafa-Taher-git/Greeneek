/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@greeneek/gnk-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Toggle Thread Details between its remembered width and closed state. */
  toggleDetails(): void
  /** Open the independent right panel (the live Fleet surface). */
  openRightbar(): void
  /** Close the right panel and collapse its track. */
  closeRightbar(): void
  /** Toggle the right panel open/closed in one call. */
  toggleRightbar(): void
  /** Open the bottom terminal activity drawer. */
  openTerminalDrawer(): void
  /** Close the bottom terminal activity drawer. */
  closeTerminalDrawer(): void
  /** Toggle the bottom terminal activity drawer. */
  toggleTerminalDrawer(): void
  /**
   * Open Settings in the main column, optionally selecting a section.
   * @param section - Settings section id to select, or undefined to keep the current section.
   */
  openSettings(section?: string): void
  /** Open the local Dashboard in the main column. */
  openDashboard(): void
  /**
   * Select a Settings section without leaving the page.
   * @param section - Settings section id to show.
   */
  selectSettingsSection(section: string): void
  /** Return to the mounted conversation. */
  showConversation(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /** Toggle Thread Details between its remembered width and closed state. */
  toggleDetails(): void {
    this.#require().toggleDetails()
  }

  /** Open the independent right panel (the live Fleet surface). */
  openRightbar(): void {
    this.#require().openRightbar()
  }

  /** Close the right sidebar and collapse its track. */
  closeRightbar(): void {
    this.#require().closeRightbar()
  }

  /** Toggle the right sidebar open/closed in one call. */
  toggleRightbar(): void {
    this.#require().toggleRightbar()
  }

  /** Open the bottom terminal activity drawer. */
  openTerminalDrawer(): void {
    this.#require().openTerminalDrawer()
  }

  /** Close the bottom terminal activity drawer. */
  closeTerminalDrawer(): void {
    this.#require().closeTerminalDrawer()
  }

  /** Toggle the bottom terminal activity drawer. */
  toggleTerminalDrawer(): void {
    this.#require().toggleTerminalDrawer()
  }

  openSettings(section?: string): void {
    this.#require().openSettings(section)
  }

  selectSettingsSection(section: string): void {
    this.#require().selectSettingsSection(section)
  }

  openDashboard(): void {
    this.#require().openDashboard()
  }

  showConversation(): void {
    this.#require().showConversation()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}

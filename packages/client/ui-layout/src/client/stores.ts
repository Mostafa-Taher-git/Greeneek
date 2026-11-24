/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@greeneek/gnk-client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  RIGHTBAR_DEFAULT, RIGHTBAR_MAX, RIGHTBAR_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * four panel preferences — the two right columns have independent widths,
 * and the terminal drawer has a visibility bit — plus the narrow-viewport
 * pair: `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
/** Normalized rectangle of one tiled session pane, in 0..1 frame coordinates. */
export type SessionTile = {
  id: string
  sessionId: string | undefined
  x: number
  y: number
  w: number
  h: number
}

/** Smallest usable tile fraction on either axis. */
export const TILE_MIN = 0.15

/**
 * Deterministic starting rectangle for a tile index (two columns, growing rows).
 * @param index - zero-based position in the tile list.
 * @returns normalized rectangle in 0..1 frame coordinates.
 */
export function tileRectFor(index: number): { x: number; y: number; w: number; h: number } {
  const w = 0.5
  const h = index < 4 ? 0.5 : Math.max(TILE_MIN, 1 / Math.ceil((index + 1) / 2))
  const column = index % 2
  return { x: column * w, y: Math.floor(index / 2) * h, w, h }
}

type LayoutState = {
  sidebar: number
  details: number
  rightbar: number
  terminalDrawerOpen: boolean
  narrow: boolean
  narrowExpanded: boolean
  mainPage: 'conversation' | 'settings' | 'dashboard' | 'automation-tasks' | 'plugins' | 'branches' | 'issues' | 'deep-agent'
  settingsSection: string | undefined
  /** Whether the right surface panel fills the workspace (T3-style maximized browser). */
  rightbarMaximized: boolean
  /** Whether the center column renders tiled session panes instead of one page. */
  tilesActive: boolean
  /** Tiled session panes with persisted geometry and per-pane selection. */
  tiles: SessionTile[]
  /** Monotonic id source for new panes. */
  nextTile: number
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  setRightbar: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  toggleDetails: (draft: LayoutState) => void
  openRightbar: (draft: LayoutState) => void
  closeRightbar: (draft: LayoutState) => void
  toggleRightbar: (draft: LayoutState) => void
  toggleRightbarMaximize: (draft: LayoutState) => void
  openTerminalDrawer: (draft: LayoutState) => void
  closeTerminalDrawer: (draft: LayoutState) => void
  toggleTerminalDrawer: (draft: LayoutState) => void
  openSettings: (draft: LayoutState, section?: string) => void
  openDashboard: (draft: LayoutState) => void
  openAutomationTasks: (draft: LayoutState) => void
  openPlugins: (draft: LayoutState) => void
  openBranches: (draft: LayoutState) => void
  openIssues: (draft: LayoutState) => void
  openDeepAgent: (draft: LayoutState) => void
  selectSettingsSection: (draft: LayoutState, section: string) => void
  showConversation: (draft: LayoutState) => void
  toggleTiles: (draft: LayoutState, sessionId?: string) => void
  addTile: (draft: LayoutState, sessionId?: string) => void
  removeTile: (draft: LayoutState, id: string) => void
  moveTile: (draft: LayoutState, id: string, x: number, y: number) => void
  resizeTile: (draft: LayoutState, id: string, w: number, h: number) => void
  reorderTile: (draft: LayoutState, id: string, to: number) => void
  setTileSession: (draft: LayoutState, id: string, sessionId: string | undefined) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    // The panel preferences survive a restart: a closed panel remembers its
    // width, an open one reopens where it was, and the terminal drawer keeps
    // its visibility. The main page does not: the app opens in the
    // conversation, whatever page was last visited. Versioned because the
    // details column now sizes the floating card, not a bordered sidebar.
    persist: 'gnk.layout.panels.v3',
    init: (): LayoutState => ({ sidebar: SIDEBAR_DEFAULT, details: 0, rightbar: 0, terminalDrawerOpen: false, narrow: false, narrowExpanded: false, mainPage: 'conversation', settingsSection: undefined, rightbarMaximized: false, tilesActive: false, tiles: [], nextTile: 1 }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      setRightbar: (d, px: number) => { d.rightbar = clampWidth(px, RIGHTBAR_MIN, RIGHTBAR_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      toggleDetails: (d) => {
        d.details = d.details === 0 ? DETAILS_DEFAULT : 0
      },
      openRightbar: (d) => { if (d.rightbar === 0) d.rightbar = RIGHTBAR_DEFAULT },
      closeRightbar: (d) => { d.rightbar = 0 },
      toggleRightbar: (d) => {
        d.rightbar = d.rightbar === 0 ? RIGHTBAR_DEFAULT : 0
        if (d.rightbar === 0) d.rightbarMaximized = false
      },
      // Maximizing needs an open panel: open it first, then fill the workspace.
      // Closing the panel always leaves maximize mode.
      toggleRightbarMaximize: (d) => {
        if (d.rightbar === 0) d.rightbar = RIGHTBAR_DEFAULT
        d.rightbarMaximized = !d.rightbarMaximized
      },
      openTerminalDrawer: (d) => { d.terminalDrawerOpen = true },
      closeTerminalDrawer: (d) => { d.terminalDrawerOpen = false },
      toggleTerminalDrawer: (d) => { d.terminalDrawerOpen = !d.terminalDrawerOpen },
      openSettings: (d, section?: string) => {
        d.mainPage = 'settings'
        d.settingsSection = section
      },
      openDashboard: (d) => {
        d.mainPage = 'dashboard'
        d.settingsSection = undefined
      },
      openAutomationTasks: (d) => {
        d.mainPage = 'automation-tasks'
        d.settingsSection = undefined
      },
      openPlugins: (d) => {
        d.mainPage = 'plugins'
        d.settingsSection = undefined
      },
      openBranches: (d) => {
        d.mainPage = 'branches'
        d.settingsSection = undefined
      },
      openIssues: (d) => {
        d.mainPage = 'issues'
        d.settingsSection = undefined
      },
      openDeepAgent: (d) => {
        d.mainPage = 'deep-agent'
        d.settingsSection = undefined
      },
      selectSettingsSection: (d, section: string) => { d.settingsSection = section },
      showConversation: (d) => {
        d.mainPage = 'conversation'
        d.settingsSection = undefined
      },
      toggleTiles: (d, sessionId?: string) => {
        d.tilesActive = !d.tilesActive
        if (d.tilesActive && d.tiles.length === 0) {
          for (let index = 0; index < 4; index += 1) {
            d.tiles.push({ id: `tile-${String(d.nextTile).padStart(2, '0')}`, sessionId: index === 0 ? sessionId : undefined, ...tileRectFor(index) })
            d.nextTile += 1
          }
        }
      },
      addTile: (d, sessionId?: string) => {
        const index = d.tiles.length
        d.tiles.push({ id: `tile-${String(d.nextTile).padStart(2, '0')}`, sessionId, ...tileRectFor(index) })
        d.nextTile += 1
        d.tilesActive = true
      },
      removeTile: (d, id: string) => {
        d.tiles = d.tiles.filter(tile => tile.id !== id)
        if (d.tiles.length === 0) d.tilesActive = false
      },
      moveTile: (d, id: string, x: number, y: number) => {
        const tile = d.tiles.find(entry => entry.id === id)
        if (tile === undefined) return
        tile.x = Math.min(1 - tile.w, Math.max(0, x))
        tile.y = Math.min(1 - tile.h, Math.max(0, y))
      },
      resizeTile: (d, id: string, w: number, h: number) => {
        const tile = d.tiles.find(entry => entry.id === id)
        if (tile === undefined) return
        tile.w = Math.min(1 - tile.x, Math.max(TILE_MIN, w))
        tile.h = Math.min(1 - tile.y, Math.max(TILE_MIN, h))
      },
      reorderTile: (d, id: string, to: number) => {
        const index = d.tiles.findIndex(tile => tile.id === id)
        if (index < 0 || to < 0 || to >= d.tiles.length) return
        const [tile] = d.tiles.splice(index, 1)
        if (tile !== undefined) d.tiles.splice(to, 0, tile)
      },
      setTileSession: (d, id: string, sessionId: string | undefined) => {
        const tile = d.tiles.find(entry => entry.id === id)
        if (tile !== undefined) tile.sessionId = sessionId
      },
    },
  })
  return handle
}

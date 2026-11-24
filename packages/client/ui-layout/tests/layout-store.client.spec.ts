// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the persisted panel geometry. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@greeneek/gnk-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  RIGHTBAR_DEFAULT, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@greeneek/gnk-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'gnk.layout.panels.v3'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({ sidebar: SIDEBAR_DEFAULT, details: 0, rightbar: 0, terminalDrawerOpen: false, narrow: false, narrowExpanded: false, mainPage: 'conversation', settingsSection: undefined, rightbarMaximized: false, tilesActive: false, tiles: [], nextTile: 1 })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({ sidebar: 400, details: 0, rightbar: 0, terminalDrawerOpen: false, narrow: true, narrowExpanded: true, mainPage: 'conversation', settingsSection: undefined, rightbarMaximized: false, tilesActive: false, tiles: [], nextTile: 1 })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('toggles thread details without changing terminal drawer or right panel state', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openTerminalDrawer()
    actions.openRightbar()
    actions.toggleDetails()
    expect(store.getSnapshot()).toMatchObject({ details: DETAILS_DEFAULT, terminalDrawerOpen: true, rightbar: RIGHTBAR_DEFAULT })
    actions.toggleDetails()
    expect(store.getSnapshot()).toMatchObject({ details: 0, terminalDrawerOpen: true, rightbar: RIGHTBAR_DEFAULT })
  })

  it('opens and closes the independent right panel', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar()
    expect(store.getSnapshot().rightbar).toBe(RIGHTBAR_DEFAULT)
    expect(store.getSnapshot().details).toBe(0)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.closeRightbar()
    expect(store.getSnapshot().rightbar).toBe(0)
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.toggleRightbar()
    expect(store.getSnapshot().rightbar).toBe(RIGHTBAR_DEFAULT)
    actions.toggleRightbar()
    expect(store.getSnapshot().rightbar).toBe(0)
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
  })

  it('maximizes the right panel only while it is open, and leaving maximize restores the width', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbarMaximize()
    expect(store.getSnapshot()).toMatchObject({ rightbar: RIGHTBAR_DEFAULT, rightbarMaximized: true })
    actions.toggleRightbarMaximize()
    expect(store.getSnapshot().rightbarMaximized).toBe(false)
    actions.toggleRightbarMaximize()
    actions.toggleRightbar()
    expect(store.getSnapshot()).toMatchObject({ rightbar: 0, rightbarMaximized: false })
  })

  it('toggles the terminal drawer independently', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    actions.openRightbar()
    actions.toggleTerminalDrawer()
    expect(store.getSnapshot()).toMatchObject({ terminalDrawerOpen: true, details: DETAILS_DEFAULT, rightbar: RIGHTBAR_DEFAULT })
    actions.toggleTerminalDrawer()
    expect(store.getSnapshot().terminalDrawerOpen).toBe(false)
  })

  it('opens Settings at a requested section and returns to conversation', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openSettings('models')
    expect(store.getSnapshot()).toMatchObject({ mainPage: 'settings', settingsSection: 'models' })
    actions.selectSettingsSection('general')
    expect(store.getSnapshot().settingsSection).toBe('general')
    actions.showConversation()
    expect(store.getSnapshot()).toMatchObject({ mainPage: 'conversation', settingsSection: undefined })
  })

  it('opens four equal tiles from the current session and persists their geometry', () => {
    const first = createLayoutStore().create()
    first.actions.toggleTiles('session-1')
    const state = first.store.getSnapshot()
    expect(state.tilesActive).toBe(true)
    expect(state.tiles).toHaveLength(4)
    expect(state.tiles[0]).toMatchObject({ id: 'tile-01', sessionId: 'session-1', x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(state.tiles[3]).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })

    first.actions.moveTile('tile-01', 0.9, 0.9)
    first.actions.resizeTile('tile-01', 0.9, 0.9)
    expect(first.store.getSnapshot().tiles[0]).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })

    const restored = createLayoutStore().create()
    expect(restored.store.getSnapshot().tilesActive).toBe(true)
    expect(restored.store.getSnapshot().tiles).toHaveLength(4)
  })

  it('adds, reorders, and removes tiles without leaving an empty active layout', () => {
    const { store, actions } = createLayoutStore().create()
    actions.addTile('session-2')
    actions.addTile('session-3')
    actions.addTile('session-4')
    actions.addTile('session-5')
    expect(store.getSnapshot().tiles.map(tile => tile.id)).toEqual(['tile-01', 'tile-02', 'tile-03', 'tile-04'])
    actions.reorderTile('tile-04', 0)
    expect(store.getSnapshot().tiles[0]?.id).toBe('tile-04')
    actions.removeTile('tile-04')
    expect(store.getSnapshot().tiles).toHaveLength(3)
    for (const tile of [...store.getSnapshot().tiles]) actions.removeTile(tile.id)
    expect(store.getSnapshot()).toMatchObject({ tilesActive: false, tiles: [] })
  })

  it('caps the layout at four disjoint panes covering the frame', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleTiles()
    actions.addTile('session-5')
    const tiles = store.getSnapshot().tiles
    expect(tiles).toHaveLength(4)
    for (let a = 0; a < tiles.length; a += 1) {
      for (let b = a + 1; b < tiles.length; b += 1) {
        const left = tiles[a]!
        const right = tiles[b]!
        const overlaps = left.x < right.x + right.w - 1e-9
          && right.x < left.x + left.w - 1e-9
          && left.y < right.y + right.h - 1e-9
          && right.y < left.y + left.h - 1e-9
        expect(overlaps, `${left.id} overlaps ${right.id}`).toBe(false)
      }
    }
    expect(Math.max(...tiles.map(tile => tile.y + tile.h))).toBeCloseTo(1, 6)
    expect(Math.max(...tiles.map(tile => tile.x + tile.w))).toBeCloseTo(1, 6)
  })

  it('persists the panel geometry across a restart', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    first.actions.openTerminalDrawer()
    expect(localStorage.getItem(PERSIST_KEY)).not.toBeNull()

    // A restart restores the panels the user left open, and the main page
    // returns to the conversation whatever page the last visit ended on.
    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toMatchObject({
      sidebar: 400,
      details: 500,
      terminalDrawerOpen: true,
    })
  })
})

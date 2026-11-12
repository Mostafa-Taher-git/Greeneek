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

const PERSIST_KEY = 'gnk.layout.panels'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({ sidebar: SIDEBAR_DEFAULT, details: 0, rightbar: 0, terminalDrawerOpen: false, narrow: false, narrowExpanded: false, mainPage: 'conversation', settingsSection: undefined })
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
    expect(store.getSnapshot()).toEqual({ sidebar: 400, details: 0, rightbar: 0, terminalDrawerOpen: false, narrow: true, narrowExpanded: true, mainPage: 'conversation', settingsSection: undefined })
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

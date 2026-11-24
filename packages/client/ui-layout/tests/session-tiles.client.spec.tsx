// @vitest-environment jsdom
/** Tiled session panes render live pages, move, resize, reorder, and close. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { SessionTiles } from '@greeneek/gnk-client-ui-layout/src/client/SessionTiles.tsx'
import type { SessionTilesProps } from '@greeneek/gnk-client-ui-layout/src/client/SessionTiles.tsx'
import { TileToggle } from '@greeneek/gnk-client-ui-layout/src/client/TileToggle.tsx'
import { createLayoutStore } from '@greeneek/gnk-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@greeneek/gnk-api-session-controller/client'

beforeEach(() => {
  localStorage.clear()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
  }))
  history.replaceState({}, '', '/?fixture=demo')
  return () => { cleanup() }
})

function mount() {
  const instance = createLayoutStore().create()
  const useStore = function useSelector<S>(selector: (s: ReturnType<typeof instance.getSnapshot>) => S): S {
    return selector(useSyncExternalStore(listener => instance.subscribe(listener), () => instance.getSnapshot()))
  }
  const useSessions = ((selector: (s: SessionListState) => unknown) => selector({
    ids: [], byId: { 's-1': { id: 's-1', title: 'First session' } }, current: 's-1', phase: 'ready',
  } as unknown as SessionListState)) as SessionTilesProps['useSessions']
  const props = {
    useStore,
    actions: instance.actions,
    useSessions,
    t: (key: string) => key,
  } as unknown as SessionTilesProps
  return { instance, view: render(<SessionTiles {...props} />) }
}

describe('session tiles', () => {
  it('renders four live pages with pane-scoped URLs and session titles', () => {
    const { instance, view } = mount()
    act(() => { instance.actions.toggleTiles('s-1') })
    const tiles = view.container.querySelectorAll('[data-tile]')
    expect(tiles).toHaveLength(4)
    expect(view.container.textContent).toContain('First session')
    const first = tiles[0]?.querySelector('iframe') as HTMLIFrameElement
    expect(first.getAttribute('src')).toContain('tile=tile-01')
    expect(first.getAttribute('src')).toContain('session=s-1')
    expect(first.getAttribute('src')).toContain('fixture=demo')
  })

  it('moves and resizes through pointer capture with clamped geometry', () => {
    const { instance, view } = mount()
    act(() => { instance.actions.toggleTiles('s-1') })
    const header = view.container.querySelector('[data-tile="tile-01"] header') as HTMLElement
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 100, clientY: 50 })
    fireEvent.pointerUp(header, { pointerId: 1 })
    expect(instance.store.getSnapshot().tiles[0]).toMatchObject({ x: 0.1, y: 0.1 })

    const handle = view.container.querySelector('[data-tile="tile-01"] [role="separator"]') as HTMLElement
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: -1000, clientY: -1000 })
    fireEvent.pointerUp(handle, { pointerId: 2 })
    expect(instance.store.getSnapshot().tiles[0]).toMatchObject({ w: 0.15, h: 0.15 })
  })

  it('reorders and closes panes', () => {
    const { instance, view } = mount()
    act(() => { instance.actions.addTile('s-1') })
    act(() => { instance.actions.addTile('s-2') })
    const later = view.container.querySelector('[data-tile="tile-02"] button[aria-label="tiles.moveEarlier"]') as HTMLButtonElement
    fireEvent.click(later)
    expect(instance.store.getSnapshot().tiles[0]?.id).toBe('tile-02')
    const close = view.container.querySelector('[data-tile="tile-01"] button[aria-label="tiles.close"]') as HTMLButtonElement
    fireEvent.click(close)
    expect(instance.store.getSnapshot().tiles).toHaveLength(1)
  })

  it('toggles tiling from the overlay control and keeps its label localized', () => {
    const instance = createLayoutStore().create()
    const useStore = function useSelector<S>(selector: (s: ReturnType<typeof instance.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(listener => instance.subscribe(listener), () => instance.getSnapshot()))
    }
    const props = {
      useStore,
      actions: instance.actions,
      useSessions: () => 's-1',
      t: (key: string) => key,
    } as unknown as SessionTilesProps
    const view = render(<TileToggle {...props} />)
    const button = view.getByRole('button', { name: 'tiles.toggle' })
    fireEvent.click(button)
    expect(instance.store.getSnapshot().tilesActive).toBe(true)
    expect(instance.store.getSnapshot().tiles).toHaveLength(4)
  })
})

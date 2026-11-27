// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createRightPanelStore } from '../src/client/right-panel-store.ts'

const PERSIST_KEY = 'gnk.rightbar.surfaces.v1'

describe('right panel surface store', () => {
  beforeEach(() => { localStorage.clear() })

  it('restores the open surfaces and active tab after a restart', () => {
    const first = createRightPanelStore().create()
    first.actions.open({ kind: 'files', title: 'Files', data: { path: '/workspace/demo' } }, false)
    first.actions.open({ kind: 'diff', title: 'Diff', data: {} }, false)
    expect(localStorage.getItem(PERSIST_KEY)).not.toBeNull()

    const second = createRightPanelStore().create()
    const snapshot = second.store.getSnapshot()
    expect(snapshot.surfaces.map(surface => surface.kind)).toEqual(['files', 'diff'])
    expect(snapshot.activeId).toBe(snapshot.surfaces[1]?.id)

    // Restored ids must not collide with newly opened surfaces.
    second.actions.open({ kind: 'device', title: 'Device', data: {} }, false)
    const final = second.store.getSnapshot()
    expect(new Set(final.surfaces.map(surface => surface.id)).size).toBe(3)
  })

  it('starts at the launcher when no surfaces were persisted', () => {
    const handle = createRightPanelStore().create()
    expect(handle.store.getSnapshot()).toEqual({ surfaces: [], activeId: undefined, nextId: 1 })
  })
})

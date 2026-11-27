/**
 * Right-panel surface state: the descriptors a session has opened, which one
 * is active, and the actions that own their lifecycle. The store is declared
 * on the `rightbar` registration; the renderer binds `useStore` and the
 * component writes only through `actions`.
 */
import { defineStore, type EngineStoreHandle } from '@greeneek/gnk-client-store'

/** The surfaces the launcher can open. */
export type SurfaceKind =
  | 'browser'
  | 'terminal'
  | 'files'
  | 'diff'
  | 'pull-request'
  | 'linked-pull-requests'
  | 'device'
  | 'side-chat'

/** One opened surface. `id` is stable for its lifetime; `data` is plain JSON. */
export interface SurfaceDescriptor {
  /** Stable identity, minted by the store when the surface opens. */
  id: string
  /** Which surface component renders it. */
  kind: SurfaceKind
  /** Display title in the tab strip. */
  title: string
  /** Optional plain-JSON opening data (profile id, path, thread id, ...). */
  data: Record<string, string>
}

type RightPanelState = {
  /** Open surfaces in tab order. */
  surfaces: readonly SurfaceDescriptor[]
  /** Id of the visible surface; undefined shows the launcher. */
  activeId: string | undefined
  /** Monotonic counter backing stable ids without a service dependency. */
  nextId: number
}

type RightPanelActions = {
  /** Open a surface, reusing an existing singleton descriptor when asked. */
  open: (draft: RightPanelState, surface: Omit<SurfaceDescriptor, 'id'>, singleton: boolean) => void
  /** Make an already-open surface visible. */
  activate: (draft: RightPanelState, id: string) => void
  /** Close one surface; the next one becomes active, or none. */
  close: (draft: RightPanelState, id: string) => void
  /** Close every surface and return to the launcher. */
  closeAll: (draft: RightPanelState) => void
}

/**
 * Create the right-panel store handle. Production code calls the factory only
 * inside `apply`; tests call it directly as the sanctioned zero-machinery path.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createRightPanelStore(): EngineStoreHandle<RightPanelState, RightPanelActions> {
  return defineStore({
    // The panel geometry lives in the layout store; the surfaces the user left
    // open belong here. Versioned so a changed descriptor can be dropped.
    persist: 'gnk.rightbar.surfaces.v1',
    init: (): RightPanelState => ({ surfaces: [], activeId: undefined, nextId: 1 }),
    actions: {
      open: (draft, surface, singleton) => {
        if (singleton) {
          const existing = draft.surfaces.find(item => item.kind === surface.kind)
          if (existing !== undefined) {
            draft.activeId = existing.id
            return
          }
        }
        const id = `surface-${draft.nextId}`
        draft.nextId += 1
        draft.surfaces = [...draft.surfaces, { ...surface, id }]
        draft.activeId = id
      },
      activate: (draft, id) => {
        if (draft.surfaces.some(surface => surface.id === id)) draft.activeId = id
      },
      close: (draft, id) => {
        const index = draft.surfaces.findIndex(surface => surface.id === id)
        if (index < 0) return
        draft.surfaces = draft.surfaces.filter(surface => surface.id !== id)
        if (draft.activeId === id) {
          draft.activeId = draft.surfaces[Math.min(index, draft.surfaces.length - 1)]?.id
        }
      },
      closeAll: (draft) => {
        draft.surfaces = []
        draft.activeId = undefined
      },
    },
  })
}

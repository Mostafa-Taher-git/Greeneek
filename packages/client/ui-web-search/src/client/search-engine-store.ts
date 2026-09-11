/**
 * Search-engine row slot store: a mirror of the two Host settings scopes.
 * The plugin's apply-world change listener is the only writer; the row
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@greeneek/gnk-client-store'

/** Store state mirrored from the engine and custom-endpoint snapshots. */
export interface SearchEngineRowState {
  /** Active engine id; '' means auto-select. */
  engine: string
  /** Custom endpoint base shown in the inputs. */
  customBaseURL: string
  /** Custom endpoint model shown in the inputs. */
  customModel: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type SearchEngineRowActions = {
  sync: (draft: SearchEngineRowState, engine: string, customBaseURL: string, customModel: string, revision: number) => void
}

/**
 * Declares the search-engine row state and write surface.
 * @returns the store handle.
 */
export function createSearchEngineRowStore(): EngineStoreHandle<SearchEngineRowState, SearchEngineRowActions> {
  return defineStore({
    init: (): SearchEngineRowState => ({ engine: '', customBaseURL: '', customModel: '', revision: -1 }),
    actions: {
      sync: (d, engine: string, customBaseURL: string, customModel: string, revision: number) => {
        if (revision <= d.revision) return
        d.engine = engine
        d.customBaseURL = customBaseURL
        d.customModel = customModel
        d.revision = revision
      },
    },
  })
}

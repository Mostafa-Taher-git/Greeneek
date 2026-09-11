/** Search-engine row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createSearchEngineRowStore } from '../src/client/search-engine-store.ts'

describe('createSearchEngineRowStore', () => {
  it('init shape: empty mirror with revision at -1', () => {
    const store = createSearchEngineRowStore().create()
    expect(store.getSnapshot()).toEqual({ engine: '', customBaseURL: '', customModel: '', revision: -1 })
  })

  it('sync mirrors the snapshot and advances the revision', () => {
    const store = createSearchEngineRowStore().create()
    store.actions.sync('google', '', '', 0)
    expect(store.getSnapshot()).toEqual({ engine: 'google', customBaseURL: '', customModel: '', revision: 0 })
    store.actions.sync('', 'https://x.test', 'm', 1)
    expect(store.getSnapshot()).toEqual({ engine: '', customBaseURL: 'https://x.test', customModel: 'm', revision: 1 })
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createSearchEngineRowStore().create()
    store.actions.sync('google', '', '', 5)
    store.actions.sync('duckduckgo', '', '', 4)
    store.actions.sync('duckduckgo', '', '', 5)
    expect(store.getSnapshot().engine).toBe('google')
    expect(store.getSnapshot().revision).toBe(5)
  })
})

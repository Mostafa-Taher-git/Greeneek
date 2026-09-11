// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceSnapshot } from '@greeneek/gnk-api-workspace-controller/client'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import { bindSnapshotSelector } from '@greeneek/gnk-client-test-runtime'
import { SearchEngineRow } from '../src/client/SearchEngineRow.tsx'
import type { SearchEngineRowComponentProps } from '../src/client/SearchEngineRow.tsx'
import { createSearchEngineRowStore } from '../src/client/search-engine-store.ts'

afterEach(cleanup)

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<SearchEngineRowComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SearchEngineRowComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(engine = '', customBaseURL = '', customModel = '') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createSearchEngineRowStore().create()
  store.actions.sync(engine, customBaseURL, customModel, 0)
  const setEngine = vi.fn()
  const setCustom = vi.fn()
  const props: SearchEngineRowComponentProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => key,
    setEngine,
    setCustom,
  }
  render(<SearchEngineRow {...props} />)
  return { store, setEngine, setCustom }
}

describe('SearchEngineRow', () => {
  it('shows the title, description, and the active engine label on the selector pill', () => {
    mount('duckduckgo')
    expect(screen.getByText('engine.title')).toBeDefined()
    expect(screen.getByText('engine.description')).toBeDefined()
    const trigger = screen.getByRole('button', { name: /engine\.duckduckgo/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the menu, selects an engine, and closes', () => {
    const b = mount('')
    const trigger = screen.getByRole('button', { name: /engine\.auto/ })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'engine.google' }))
    expect(b.setEngine).toHaveBeenCalledWith('google')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem', { name: 'engine.google' })).toBeNull()
  })

  it('closes on outside pointerdown without selecting', () => {
    const b = mount('')
    const trigger = screen.getByRole('button', { name: /engine\.auto/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'engine.google' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'engine.google' })).toBeNull()
    expect(b.setEngine).not.toHaveBeenCalled()
  })

  it('hides the custom inputs unless the Custom engine is active', () => {
    mount('google')
    expect(screen.queryByPlaceholderText('custom.endpointPlaceholder')).toBeNull()
  })

  it('shows endpoint/model inputs and saves through setCustom', async () => {
    const b = mount('greeneek-official', 'https://old.test', 'old-model')
    const endpoint = screen.getByPlaceholderText('custom.endpointPlaceholder') as HTMLInputElement
    const model = screen.getByPlaceholderText('custom.modelPlaceholder') as HTMLInputElement
    expect(endpoint.value).toBe('https://old.test')
    expect(model.value).toBe('old-model')
    fireEvent.change(endpoint, { target: { value: 'https://new.test' } })
    fireEvent.change(model, { target: { value: 'new-model' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'custom.save' }))
    })
    expect(b.setCustom).toHaveBeenCalledWith('https://new.test', 'new-model')
  })

  it('saves the stored values untouched and releases the edit flags on blur', async () => {
    const b = mount('greeneek-official', 'https://old.test', 'old-model')
    const endpoint = screen.getByPlaceholderText('custom.endpointPlaceholder') as HTMLInputElement
    const modelInput = screen.getByPlaceholderText('custom.modelPlaceholder') as HTMLInputElement
    fireEvent.change(endpoint, { target: { value: 'https://draft.test' } })
    fireEvent.change(modelInput, { target: { value: 'draft-model' } })
    fireEvent.blur(endpoint)
    fireEvent.blur(modelInput)
    // Blur releases the drafts: the inputs show the stored values again and a
    // save without edits persists the stored pair, covering both value arms.
    expect(endpoint.value).toBe('https://old.test')
    expect(modelInput.value).toBe('old-model')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'custom.save' }))
    })
    expect(b.setCustom).toHaveBeenCalledWith('https://old.test', 'old-model')
  })
})

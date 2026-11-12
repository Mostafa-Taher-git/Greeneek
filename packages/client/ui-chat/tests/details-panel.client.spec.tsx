// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import type { SessionListState } from '@greeneek/gnk-api-session-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { DetailsSlotProps } from '@greeneek/gnk-client-ui-chat/client'
import type { TerminalDrawerProps } from '../src/client/details/TerminalDrawer.tsx'
import { en as commonEn } from '@greeneek/gnk-client-locale/src/locales/en.ts'
import { createChatStore } from '../src/client/stores.ts'
import { DetailsPanel } from '../src/client/details/DetailsPanel.tsx'
import { TerminalDrawer } from '../src/client/details/TerminalDrawer.tsx'
import { en } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const SID = 'session-details' as SessionId
const t = makeTranslate(en, commonEn)

function emptySessions() {
  return createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {},
    jobsBySession: {}, currentAddress: undefined,
  })
}

function mountDetails(selected = false) {
  const store = createChatStore().create()
  if (selected) store.actions.select({ turnSeq: 1, callId: 'term-1', toolName: 'bash' })
  const keys: string[] = []
  const renderSlot = ((key: string) => {
    keys.push(key)
    if (key === 'conversation.details.actions') return <button>Session actions</button>
    if (key === 'conversation.details.tool') return <div>Tool renderer</div>
    return null
  }) as unknown as DetailsSlotProps['renderSlot']
  const snapshot = chatSnapshotFixture({
    runningCalls: [{
      callId: 'term-1', name: 'bash', argsRaw: '{"command":"pwd"}', turn: 1, step: 1, time: 2, subCalls: [],
    }],
  })
  const props = {
    sessionId: SID,
    useSessions: bindSnapshotSelector(emptySessions()),
    useChat: bindSnapshotSelector(createSnapshotStore(snapshot)),
    useStore: bindSnapshotSelector(store.store),
    actions: store.actions,
    renderSlot,
    closeDetails: vi.fn(),
    t,
  } as unknown as DetailsSlotProps
  return { ...render(<DetailsPanel {...props} />), keys, store }
}

afterEach(cleanup)

describe('Thread Details panel', () => {
  it('hosts session actions in its header without a competing Fleet tab', () => {
    const view = mountDetails()
    expect(view.getByText('Details')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Session actions' })).toBeTruthy()
    expect(view.keys).toEqual(['conversation.details.actions'])
    expect(view.queryByRole('tab')).toBeNull()
  })

  it('shows the selected tool output in the details body', () => {
    const view = mountDetails(true)
    expect(view.getByText('bash')).toBeTruthy()
    expect(view.getByText('Tool renderer')).toBeTruthy()
    expect(view.keys).toEqual(['conversation.details.actions', 'conversation.details.tool'])
  })
})

describe('Terminal activity drawer', () => {
  it('shows a running shell call and its input, and closes on request', () => {
    const close = vi.fn()
    const props = {
      sessionId: SID,
      useChat: bindSnapshotSelector(createSnapshotStore(chatSnapshotFixture({
        runningCalls: [{
          callId: 'term-1', name: 'bash', argsRaw: '{"command":"pwd"}', turn: 1, step: 1, time: 2, subCalls: [],
        }],
      }))),
      close,
      t,
    } as unknown as TerminalDrawerProps
    const view = render(<TerminalDrawer {...props} />)
    expect(view.getByRole('region', { name: 'Terminal activity' })).toBeTruthy()
    expect(view.getByText('bash')).toBeTruthy()
    expect(view.getByText('Running')).toBeTruthy()
    // The command block renders the pretty-printed arguments as one preformatted
    // text, so the assertion matches inside that element.
    expect(view.getByText(/"command": "pwd"/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Close details' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('shows an empty state without terminal-related calls', () => {
    const props = {
      sessionId: SID,
      useChat: bindSnapshotSelector(createSnapshotStore(chatSnapshotFixture())),
      close: vi.fn(),
      t,
    } as unknown as TerminalDrawerProps
    const view = render(<TerminalDrawer {...props} />)
    expect(view.getByText('No terminal activity in the loaded session history.')).toBeTruthy()
  })
})

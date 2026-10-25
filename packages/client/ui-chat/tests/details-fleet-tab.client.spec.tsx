// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { HostObservable } from '@greeneek/gnk-client-ui-slots'
import { bindSnapshotSelector, makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import type { SessionListState } from '@greeneek/gnk-api-session-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { DetailsSlotProps, SelectionTarget } from '@greeneek/gnk-client-ui-chat/client'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import type { ChatStore } from '../src/client/contract/slots.ts'
import { DetailsPanel } from '../src/client/details/DetailsPanel.tsx'
import { FleetTabAvailability, type FleetSlotRegistry } from '../src/client/details/fleet-tab.ts'
import { zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const SID = 'session' as SessionId
const t = makeTranslate(zh, commonZh)

/** A boolean source a spec moves by hand, standing in for slot occupancy. */
function occupancySource(initial: boolean): HostObservable<boolean> & { set: (next: boolean) => void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: boolean) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A child dispatcher that records each key the panel dispatches. */
function probe(): { renderSlot: DetailsSlotProps['renderSlot']; keys: string[] } {
  const keys: string[] = []
  const renderSlot = ((key: string) => {
    keys.push(key)
    return key === 'conversation.details.fleet' ? <div>fleet-body</div> : <div>tool-body</div>
  }) as unknown as DetailsSlotProps['renderSlot']
  return { renderSlot, keys }
}

/**
 * Mount the details panel over a scripted fleet occupancy and selection.
 * @param fleet - the occupancy source the panel reads.
 * @param chat - the shared Chat store, already holding the desired selection.
 * @param renderSlot - the child dispatcher probe.
 * @returns the rendered view.
 */
function mountPanel(
  fleet: HostObservable<boolean>,
  chat: ReturnType<ChatStore['create']>,
  renderSlot: DetailsSlotProps['renderSlot'],
) {
  const emptyList = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {},
    jobsBySession: {}, currentAddress: undefined,
  })
  const unused = () => { throw new Error('unused by the details panel') }
  const props = {
    useFleet: bindSnapshotSelector(fleet),
    SessionProvider: ({ children }: { children: ReactNode }) => children,
    renderSlot,
    sessionId: SID,
    useSession: unused,
    useChat: bindSnapshotSelector(createSnapshotStore(chatSnapshotFixture())),
    useConversation: unused,
    useTrajectory: unused,
    useSessions: bindSnapshotSelector(emptyList),
    useSessionPendingInteraction: unused,
    useWorkspaces: unused,
    useProjection: unused,
    useInput: unused,
    inputActions: {
      setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {},
    },
    useStore: bindSnapshotSelector(chat),
    actions: chat.actions,
    closeDetails: vi.fn(),
    t,
  } as unknown as DetailsSlotProps
  return render(<DetailsPanel {...props} />)
}

/** The shared Chat store seeded with one selection. */
function storeWith(selection: SelectionTarget | null): ReturnType<ChatStore['create']> {
  const chat = createChatStore().create()
  chat.actions.select(selection)
  return chat
}

afterEach(() => {
  cleanup()
})

describe('DetailsPanel tabs', () => {
  it('keeps the single-body panel while no surface occupies the Fleet slot', () => {
    const { renderSlot, keys } = probe()
    mountPanel(occupancySource(false), storeWith(null), renderSlot)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText('详情')).toBeTruthy()
    expect(keys).toEqual([])
  })

  it('offers both tabs and reads the Tool body first', () => {
    const { renderSlot } = probe()
    mountPanel(
      occupancySource(true),
      storeWith({ turnSeq: 1, callId: 'c1', toolName: 'read' } satisfies SelectionTarget),
      renderSlot,
    )
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: '工具' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('fleet-body')).toBeNull()
    expect(screen.getByText('该调用不在当前窗口内')).toBeTruthy()
    // The tab row took the header title seat, so the selected call names itself.
    expect(screen.getByText('read')).toBeTruthy()
  })

  it('switches to the fleet body on one click and back on one more', () => {
    const { renderSlot, keys } = probe()
    mountPanel(occupancySource(true), storeWith(null), renderSlot)
    fireEvent.click(screen.getByRole('tab', { name: '舰队' }))
    expect(keys).toContain('conversation.details.fleet')
    expect(screen.getByText('fleet-body')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '工具' }))
    expect(screen.queryByText('fleet-body')).toBeNull()
  })

  it('retires the fleet pick when the transcript selects a Tool call', () => {
    const { renderSlot } = probe()
    const chat = storeWith(null)
    mountPanel(occupancySource(true), chat, renderSlot)
    fireEvent.click(screen.getByRole('tab', { name: '舰队' }))

    chat.actions.select({ turnSeq: 4, callId: 'c9', toolName: 'grep' } satisfies SelectionTarget)
    expect(chat.getSnapshot().detailsTab).toBeNull()
  })

  it('hides the tab strip again when the fleet entry leaves', () => {
    const { renderSlot } = probe()
    const fleet = occupancySource(true)
    mountPanel(fleet, storeWith(null), renderSlot)
    fireEvent.click(screen.getByRole('tab', { name: '舰队' }))
    expect(screen.getByRole('tab', { name: '舰队' }).getAttribute('aria-selected')).toBe('true')

    act(() => { fleet.set(false) })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText('点击消息流中的工具行查看详情')).toBeTruthy()
  })
})

describe('FleetTabAvailability', () => {
  /** A slot registry double whose occupancy and change feed a spec drives. */
  function registry(occupied: number): FleetSlotRegistry & { feed: () => void; setOccupied: (n: number) => void } {
    let count = occupied
    const listeners = new Set<() => void>()
    return {
      entriesOfSlot: () => Array.from({ length: count }, (_, index) => index),
      subscribe: (_key, fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
      feed: () => {
        for (const listener of [...listeners]) listener()
      },
      setOccupied: (next: number) => {
        count = next
      },
    }
  }

  it('reads occupancy at construction and publishes each real change once', () => {
    const slots = registry(1)
    const source = new FleetTabAvailability(slots)
    const listener = vi.fn()
    source.subscribe(listener)
    expect(source.getSnapshot()).toBe(true)

    slots.setOccupied(2)
    slots.feed()
    expect(listener).not.toHaveBeenCalled()

    slots.setOccupied(0)
    slots.feed()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(source.getSnapshot()).toBe(false)
    source.dispose()
  })

  it('drops the registry feed on dispose', () => {
    const slots = registry(0)
    const source = new FleetTabAvailability(slots)
    const listener = vi.fn()
    source.subscribe(listener)
    source.dispose()

    slots.setOccupied(3)
    slots.feed()
    expect(listener).not.toHaveBeenCalled()
    expect(source.getSnapshot()).toBe(false)
  })

  it('contains a subscriber that throws', () => {
    const slots = registry(0)
    const source = new FleetTabAvailability(slots)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    source.subscribe(() => { throw new Error('bad listener') })
    const second = vi.fn()
    source.subscribe(second)

    slots.setOccupied(1)
    slots.feed()
    expect(second).toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
    source.dispose()
  })
})

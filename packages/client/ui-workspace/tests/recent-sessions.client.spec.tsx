// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import type { SessionListState, SessionSummary } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@greeneek/gnk-api-workspace-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { RecentSessionsSeat } from '../src/client/RecentSessionsSeat.tsx'
import type { RecentSessionsSeatProps } from '../src/client/RecentSessionsSeat.tsx'

afterEach(cleanup)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary =>
  ({ id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...overrides })
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined, phase: 'ready',
  subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot =>
  ({ items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })
const workspace = (
  id: string,
  sessionIds: readonly SessionId[],
  overrides: Partial<WorkspaceView> = {},
): WorkspaceView => ({
  workspaceId: wid(id), path: `/w/${id}`, title: id, sessionIds: [...sessionIds],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function mountSeat(options: {
  workspaceId?: WorkspaceId | undefined
  sessions: SessionListState
  workspaces: WorkspaceSnapshot
  open: (sessionId: SessionId) => void
}): void {
  const useSessions = bindSnapshotSelector(createSnapshotStore(options.sessions))
  const useWorkspaces = bindSnapshotSelector(createSnapshotStore(options.workspaces))
  render(<RecentSessionsSeat {...({
    ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
    open: options.open,
    useSessions,
    useWorkspaces,
    t: makeTranslate(zh, commonZh),
  } as unknown as RecentSessionsSeatProps)} />)
}

describe('RecentSessionsSeat', () => {
  it('lists the workspace sessions newest-first and opens one', () => {
    const open = vi.fn()
    mountSeat({
      workspaceId: wid('ws'),
      open,
      sessions: sessionState([summary('s1', 2), summary('s2', 5), summary('s3', 1)]),
      workspaces: workspaceState([workspace('ws', [sid('s1'), sid('s2'), sid('s3')])]),
    })

    expect(screen.getByText('最近在 ws')).toBeTruthy()
    const rows = screen.getAllByRole('button')
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('s2'),
      expect.stringContaining('s1'),
      expect.stringContaining('s3'),
    ])
    fireEvent.click(screen.getByText('s1'))
    expect(open).toHaveBeenCalledWith(sid('s1'))
  })

  it('caps the list at five rows', () => {
    const items = Array.from({ length: 7 }, (_, index) => summary(`s${index}`, index))
    mountSeat({
      workspaceId: wid('ws'),
      open: vi.fn(),
      sessions: sessionState(items),
      workspaces: workspaceState([workspace('ws', items.map(item => item.id))]),
    })
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('falls back to the most recent workspace with a visible session', () => {
    mountSeat({
      open: vi.fn(),
      sessions: sessionState([summary('s1', 1), summary('s2', 2)]),
      workspaces: workspaceState([
        workspace('old', [sid('s1')], { updatedAt: '2026-01-01T00:00:00.000Z' }),
        workspace('new', [sid('s2')], { updatedAt: '2026-02-01T00:00:00.000Z' }),
        workspace('empty', [], { updatedAt: '2026-03-01T00:00:00.000Z' }),
      ]),
    })
    expect(screen.getByText('最近在 new')).toBeTruthy()
    expect(screen.getByText('s2')).toBeTruthy()
  })

  it('hides subagent and archived sessions', () => {
    mountSeat({
      workspaceId: wid('ws'),
      open: vi.fn(),
      sessions: sessionState([
        summary('keep', 1),
        summary('sub', 9, { origin: 'subagent' }),
        summary('gone', 8),
      ]),
      workspaces: {
        ...workspaceState([workspace('ws', [sid('keep'), sid('sub'), sid('gone')])]),
        archivedSessionIds: [sid('gone')],
      },
    })
    expect(screen.getByText('keep')).toBeTruthy()
    expect(screen.queryByText('sub')).toBeNull()
    expect(screen.queryByText('gone')).toBeNull()
  })

  it('renders the empty sentence for an empty workspace', () => {
    mountSeat({
      workspaceId: wid('ws'),
      open: vi.fn(),
      sessions: sessionState([]),
      workspaces: workspaceState([workspace('ws', [])]),
    })
    expect(screen.getByText('最近在 ws')).toBeTruthy()
    expect(screen.getByText('暂无最近会话')).toBeTruthy()
  })
})

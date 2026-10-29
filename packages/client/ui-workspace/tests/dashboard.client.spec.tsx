// @vitest-environment jsdom
// Dashboard view: totals come from the session projections, unknown cost stays
// absent, and the close action returns to the conversation.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceSnapshot } from '@greeneek/gnk-api-workspace-controller/client'
import { DashboardPage, type DashboardPageProps } from '../src/client/DashboardPage.tsx'
import { en, type WorkspaceKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: WorkspaceKey, params?: Record<string, string | number>): string => {
  let text = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

const list = {
  ids: ['a', 'b'],
  byId: {
    a: {
      id: 'a', displayTitle: 'Alpha', running: true, blank: false, updatedAt: 10,
      projectionValues: {
        sessionStats: { turns: 2, steps: 4, decodeTokens: 100 },
        modelSelection: { lastUsed: null, next: { provider: 'openrouter', model: 'one' } },
      },
    },
    b: {
      id: 'b', displayTitle: 'Beta', running: false, blank: false, updatedAt: 20,
      projectionValues: {
        sessionStats: { turns: 3, steps: 5, decodeTokens: 50 },
        modelSelection: { lastUsed: { provider: 'openrouter', model: 'one' }, next: null },
      },
    },
  },
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
} as unknown as SessionListState

const workspaces = {
  items: [{ workspaceId: 'w1', path: '/project', title: 'Project', sessionIds: ['a', 'b'], createdAt: '', updatedAt: '' }],
  archivedSessionIds: [],
  state: 'ready',
  phase: 'ready',
  error: null,
} as unknown as WorkspaceSnapshot

function props(): DashboardPageProps {
  return {
    useSessions: (selector: (state: SessionListState) => unknown) => selector(list),
    useWorkspaces: (selector: (state: WorkspaceSnapshot) => unknown) => selector(workspaces),
    t,
    close: vi.fn(),
  } as unknown as DashboardPageProps
}

describe('DashboardPage', () => {
  it('renders projection totals, model usage, and the recent rows', () => {
    render(<DashboardPage {...props()} />)
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Sessions').parentElement?.textContent).toContain('2')
    expect(screen.getByText('Workspaces').parentElement?.textContent).toContain('1')
    expect(screen.getByText('Running now').parentElement?.textContent).toContain('1')
    expect(screen.getAllByText('Turns')[0]?.parentElement?.textContent).toContain('5')
    expect(screen.getAllByText('Steps')[0]?.parentElement?.textContent).toContain('9')
    expect(screen.getAllByText('openrouter · one').length).toBeGreaterThan(0)
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText(/Input tokens and cost are not recorded/)).toBeTruthy()
  })

  it('closes back to the conversation', () => {
    const close = vi.fn()
    render(<DashboardPage {...props()} close={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(close).toHaveBeenCalledOnce()
  })
})

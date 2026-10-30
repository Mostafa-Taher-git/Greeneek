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

/** No workspace holds these sessions, so each row falls back to its own cwd. */
const detached = {
  ...workspaces,
  items: [{ workspaceId: 'w9', path: '/other', title: 'Other', sessionIds: [], createdAt: '', updatedAt: '' }],
} as unknown as WorkspaceSnapshot

/** Test accessor: the brand on SessionId is not part of these fixtures. */
const row = (id: string): Record<string, unknown> =>
  (list.byId as unknown as Record<string, Record<string, unknown>>)[id] ?? {}

function props(
  state: SessionListState = list,
  workspaceState: WorkspaceSnapshot = workspaces,
): DashboardPageProps {
  return {
    useSessions: (selector: (value: SessionListState) => unknown) => selector(state),
    useWorkspaces: (selector: (state: WorkspaceSnapshot) => unknown) => selector(workspaceState),
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
    // No sourced price covers the route, so spend states the reason instead of a number.
    expect(screen.getByText('Spend').parentElement?.textContent).toContain('Unknown')
    expect(screen.getByText(/No versioned price covers this route/)).toBeTruthy()
    expect(screen.getByText(/Spend appears only when a versioned price/)).toBeTruthy()
  })

  it('shows the empty state instead of zeroed sections when nothing is recorded', () => {
    const empty = { ...list, ids: [], byId: {} } as unknown as SessionListState
    render(<DashboardPage {...props(empty)} />)
    expect(screen.getByText('Nothing recorded yet')).toBeTruthy()
    expect(screen.queryByText('Recent sessions')).toBeNull()
  })

  it('reports spend from a covering catalog entry and names its version', () => {
    const priced = {
      ...list,
      byId: {
        ...list.byId,
        a: {
          ...row('a'),
          cwd: '/work/alpha',
          projectionValues: {
            sessionStats: { turns: 2, steps: 4, decodeTokens: 100 },
            modelSelection: { lastUsed: null, next: { provider: 'openrouter', model: 'one' } },
            tokenUsage: { uncachedInputTokens: 2_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
            agentPreset: 'standard',
          },
        },
      },
    } as unknown as SessionListState
    render(
      <DashboardPage
        {...props(priced)}
        pricing={{
          version: '3',
          entries: [{
            provider: 'openrouter',
            model: 'one',
            currency: 'USD',
            inputPerMillion: 1,
            outputPerMillion: 2,
            source: 'fixture rate card',
            effectiveFrom: '1970-01-01',
          }],
        }}
      />,
    )
    expect(screen.getByText('Spend').parentElement?.textContent).toContain('USD')
    expect(screen.getByText('Spend').parentElement?.textContent).not.toContain('Unknown')
    expect(screen.getByText('Price catalog v3')).toBeTruthy()
    // A projected provider and preset both appear in their breakdowns.
    expect(screen.getAllByText('openrouter').length).toBeGreaterThan(0)
    expect(screen.getAllByText('standard').length).toBeGreaterThan(0)
  })

  it('names the mixed-currency reason instead of inventing a total', () => {
    const mixed = {
      ...list,
      byId: {
        a: {
          ...row('a'),
          projectionValues: {
            modelSelection: { lastUsed: null, next: { provider: 'openrouter', model: 'one' } },
            tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
        b: {
          ...row('b'),
          projectionValues: {
            modelSelection: { lastUsed: { provider: 'euro', model: 'one' }, next: null },
            tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      },
    } as unknown as SessionListState
    const rate = { inputPerMillion: 1, outputPerMillion: 1, source: 'fixture', effectiveFrom: '1970-01-01' }
    render(
      <DashboardPage
        {...props(mixed)}
        pricing={{
          version: '4',
          entries: [
            { provider: 'openrouter', model: 'one', currency: 'USD', ...rate },
            { provider: 'euro', model: 'one', currency: 'EUR', ...rate },
          ],
        }}
      />,
    )
    expect(screen.getByText('Spend').parentElement?.textContent).toContain('Unknown')
    expect(screen.getByText(/Routes bill in different currencies/)).toBeTruthy()
  })

  it('names the no-usage reason when no tokens are recorded', () => {
    const noUsage = {
      ...list,
      byId: {
        a: { ...row('a'), projectionValues: { sessionStats: { turns: 1, steps: 1, decodeTokens: 0 } } },
      },
    } as unknown as SessionListState
    render(<DashboardPage {...props(noUsage)} />)
    expect(screen.getByText(/No token usage has been recorded yet/)).toBeTruthy()
    expect(screen.getByText('No provider recorded yet.')).toBeTruthy()
    expect(screen.getByText('No preset recorded yet.')).toBeTruthy()
    expect(screen.getByText('No model recorded yet.')).toBeTruthy()
  })

  it('marks an unmeasured row, keeps blank rows out, and falls back for a missing workspace name', () => {
    const mixed = {
      ...list,
      ids: ['blank', 'orphan', 'unmeasured', 'a'],
      byId: {
        blank: { id: 'blank', displayTitle: 'Blank', running: false, blank: true, updatedAt: 1 },
        unmeasured: { id: 'unmeasured', displayTitle: 'Unmeasured', running: false, blank: false, updatedAt: 2 },
        a: { ...row('a'), cwd: '/work/alpha', origin: 'subagent' },
      },
    } as unknown as SessionListState
    render(<DashboardPage {...props(mixed, detached)} />)
    // The blank row is filtered out; the row without projection values renders as unmeasured.
    expect(screen.queryByText('Blank')).toBeNull()
    expect(screen.getByText('Unmeasured')).toBeTruthy()
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(1)
    // With no workspace holding the session, the name falls back to its cwd.
    expect(screen.getByText('/work/alpha')).toBeTruthy()
    expect(screen.getByText(/had no projection when this page opened/)).toBeTruthy()
  })

  it('closes back to the conversation', () => {
    const close = vi.fn()
    render(<DashboardPage {...props()} close={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(close).toHaveBeenCalledOnce()
  })
})

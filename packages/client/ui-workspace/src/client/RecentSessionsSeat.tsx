/**
 * Recent sessions under the New Session composer: the five newest visible
 * sessions of the targeted Workspace, newest first. The list is a shortcut
 * into the workspace the user is about to start in — it never mirrors the
 * whole sidebar tree, so it stays short and unscrollable.
 *
 * Data comes from the global standard hooks (`useSessions` / `useWorkspaces`);
 * the only injected verb is `open`, which routes a row through the shared
 * Session navigation action.
 */
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { SessionListState, SessionSummary } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@greeneek/gnk-api-workspace-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import { timeLabel } from './rows/Rows.tsx'
import { sessionVisible } from './tree.ts'
import css from './RecentSessionsSeat.module.css'
import rowCss from './rows/Rows.module.css'

/** Registration-side business face for the hero recent-sessions seat. */
export interface RecentSessionsInjected {
  /** Open one listed Session through the Session Controller. */
  open: (sessionId: SessionId) => void
}

/** Full component props. */
export type RecentSessionsSeatProps =
  PropsRuntime<'conversation.hero.recentSessions'>
  & PropsLocale<'workspace'>
  & InjectFace<RecentSessionsInjected>

/** The hero row budget: no scrolling, so the list must stay short. */
const LIMIT = 5

/** Newest first; the unique id is the deterministic tiebreak (same as the tree). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * The Workspace this seat lists: the owner's pick when it still exists, else
 * the most recently updated Workspace that has at least one visible Session.
 * @param workspaceId - owner-targeted Workspace, when present.
 * @param snapshot - Workspace list snapshot.
 * @param list - Session list snapshot.
 * @returns the target Workspace, or undefined when none qualifies.
 */
function targetWorkspace(
  workspaceId: WorkspaceId | undefined,
  snapshot: WorkspaceSnapshot,
  list: SessionListState,
): WorkspaceView | undefined {
  if (workspaceId !== undefined) {
    return snapshot.items.find(workspace => workspace.workspaceId === workspaceId)
  }
  const archived = new Set(snapshot.archivedSessionIds)
  const hasVisibleSession = (workspace: WorkspaceView): boolean => workspace.sessionIds.some((id) => {
    const session = list.byId[id]
    return session !== undefined && sessionVisible(session, list.current, archived)
  })
  let selected: WorkspaceView | undefined
  for (const workspace of snapshot.items) {
    if (!hasVisibleSession(workspace)) continue
    // Workspace stamps are ISO-8601, so lexicographic order is chronological.
    if (selected === undefined || workspace.updatedAt > selected.updatedAt) selected = workspace
  }
  return selected
}

/**
 * Newest visible Sessions of one Workspace, capped to the hero row budget.
 * @param workspace - source Workspace.
 * @param list - Session list snapshot (visibility + current blank Session).
 * @param archived - registry-global archived Session ids.
 * @returns at most {@link LIMIT} rows, newest first.
 */
function recentSessions(
  workspace: WorkspaceView,
  list: SessionListState,
  archived: ReadonlySet<SessionId>,
): SessionSummary[] {
  return workspace.sessionIds
    .flatMap((id) => {
      const session = list.byId[id]
      return session !== undefined && sessionVisible(session, list.current, archived) ? [session] : []
    })
    .sort(byRecency)
    .slice(0, LIMIT)
}

/**
 * Render the hero's recent-sessions list.
 * @param props - composed slot props.
 * @returns the heading plus up to five rows, or the empty sentence.
 */
export function RecentSessionsSeat({ workspaceId, open, useSessions, useWorkspaces, t }: RecentSessionsSeatProps) {
  const list = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  // One clock per render: every row in a pass agrees on "now".
  const now = Date.now()

  const target = targetWorkspace(workspaceId, workspaces, list)
  if (target === undefined) {
    return (
      <div className={css.root}>
        <p className={css.empty}>{t('recent.empty')}</p>
      </div>
    )
  }

  const sessions = recentSessions(target, list, new Set(workspaces.archivedSessionIds))

  return (
    <div className={css.root}>
      <h2 className={css.heading}>{t('recent.title', { workspace: target.title })}</h2>
      {sessions.length === 0
        ? <p className={css.empty}>{t('recent.empty')}</p>
        : (
          <ul className={css.list}>
            {sessions.map(session => (
              <li key={session.id}>
                <button
                  type="button"
                  className={clsx(rowCss.sessionRow, css.row)}
                  onClick={() => { open(session.id) }}
                >
                  <span className={rowCss.title} dir="auto">
                    {session.blank ? t('session.new') : session.displayTitle}
                  </span>
                  <span className={rowCss.time}>{timeLabel(session.updatedAt, now, t)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

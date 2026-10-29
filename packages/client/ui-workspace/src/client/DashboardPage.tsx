/**
 * Local Dashboard: session and workspace totals folded from the projections
 * the browser already holds. Input tokens and cost are deliberately absent —
 * this client has no local price or input-token record to report.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { SessionListState, SessionSummary } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceSnapshot } from '@greeneek/gnk-api-workspace-controller/client'
// Type-only: merges the sessionStats and modelSelection projection keys.
import type {} from '@greeneek/gnk-session-stats/client'
import { IconCloseOutline16 } from '@greeneek/gnk-client-ui-primitives'
import { dashboardFacts, type DashboardSession } from './dashboard-model.ts'
import { timeLabel } from './rows/Rows.tsx'
import css from './DashboardPage.module.css'

/** Registration-side face: return to the mounted conversation. */
export interface DashboardPageInjected {
  /** Close the Dashboard page. */
  close: () => void
}

/** Full page props. */
export type DashboardPageProps =
  PropsRuntime<'dashboard'>
  & PropsLocale<'workspace'>
  & InjectFace<DashboardPageInjected>

/** Western digits only; the plan forbids Eastern Arabic numerals. */
const NUMBERS = new Intl.NumberFormat('en-US')

/** Reduce one live session row to dashboard inputs. */
function dashboardSession(session: SessionSummary, workspace: string): DashboardSession {
  const selection = session.projectionValues?.modelSelection
  const next = selection?.next ?? selection?.lastUsed
  const stats = session.projectionValues?.sessionStats
  return {
    id: session.id,
    title: session.displayTitle,
    running: session.running,
    updatedAt: session.updatedAt,
    workspace,
    ...(next === null || next === undefined ? {} : { provider: next.provider, model: next.model }),
    turns: stats?.turns ?? 0,
    steps: stats?.steps ?? 0,
    outputTokens: stats?.decodeTokens ?? 0,
  }
}

/**
 * Render the Dashboard page.
 * @param props - standard session/workspace hooks, dictionary, and the close action.
 * @returns the full-height local summary.
 */
export function DashboardPage({ useSessions, useWorkspaces, t, close }: DashboardPageProps) {
  const list: SessionListState = useSessions(state => state)
  const workspaces: WorkspaceSnapshot = useWorkspaces(state => state)
  const workspaceBySession = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace.title)
  }
  const sessions = list.ids
    .map(id => list.byId[id])
    .filter((session): session is SessionSummary => session !== undefined && !session.blank)
    .map(session => dashboardSession(session, workspaceBySession.get(session.id) ?? session.cwd ?? t('dashboard.unknown')))
  const facts = dashboardFacts({
    sessions,
    workspaces: workspaces.items.map(workspace => ({
      id: workspace.workspaceId,
      title: workspace.title,
      sessionIds: workspace.sessionIds,
    })),
    archivedSessionIds: workspaces.archivedSessionIds,
  })
  const cards = [
    { key: 'sessions', label: t('dashboard.sessions'), value: facts.sessions },
    { key: 'workspaces', label: t('dashboard.workspaces'), value: facts.workspaces },
    { key: 'running', label: t('dashboard.running'), value: facts.running },
    { key: 'turns', label: t('dashboard.turns'), value: facts.turns },
    { key: 'steps', label: t('dashboard.steps'), value: facts.steps },
    { key: 'tokens', label: t('dashboard.outputTokens'), value: facts.outputTokens },
  ]
  const mostUsed = facts.models[0]?.count ?? 1
  const now = Date.now()
  return (
    <div className={css.page}>
      <div className={css.inner}>
        <header className={css.header}>
          <div className={css.titleBlock}>
            <h1 className={css.title}>{t('dashboard.title')}</h1>
            <p className={css.description}>{t('dashboard.description')}</p>
          </div>
          <button type="button" className={css.close} aria-label={t('dashboard.close')} onClick={close}>
            <IconCloseOutline16 />
          </button>
        </header>

        <section className={css.stats}>
          {cards.map(card => (
            <article className={css.stat} key={card.key}>
              <span className={css.statLabel}>{card.label}</span>
              <span className={css.statValue}>{NUMBERS.format(card.value)}</span>
            </article>
          ))}
        </section>

        <section className={css.section}>
          <h2 className={css.sectionTitle}>{t('dashboard.models')}</h2>
          {facts.models.length === 0
            ? <p className={css.empty}>{t('dashboard.modelsEmpty')}</p>
            : (
              <ul className={css.models} aria-label={t('dashboard.usageAria')}>
                {facts.models.map(usage => (
                  <li className={css.modelRow} key={usage.route}>
                    <span className={css.modelRoute} dir="ltr">{usage.route}</span>
                    <span className={css.modelCount}>{NUMBERS.format(usage.count)}</span>
                    <span className={css.modelTrack} aria-hidden="true">
                      <span
                        className={css.modelFill}
                        style={{ inlineSize: `${Math.max(4, Math.round((usage.count / mostUsed) * 100))}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className={css.section}>
          <h2 className={css.sectionTitle}>{t('dashboard.recent')}</h2>
          {facts.recent.length === 0
            ? <p className={css.empty}>{t('dashboard.recentEmpty')}</p>
            : (
              <div className={css.tableWrap}>
                <table className={css.table}>
                  <thead>
                    <tr>
                      <th>{t('dashboard.session')}</th>
                      <th>{t('dashboard.workspace')}</th>
                      <th>{t('dashboard.model')}</th>
                      <th>{t('dashboard.updated')}</th>
                      <th className={css.number}>{t('dashboard.turns')}</th>
                      <th className={css.number}>{t('dashboard.steps')}</th>
                      <th className={css.number}>{t('dashboard.outputTokens')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.recent.map(row => (
                      <tr key={row.id}>
                        <td><span dir="auto">{row.title}</span></td>
                        <td><span dir="auto">{row.workspace}</span></td>
                        <td>{row.model === undefined ? t('dashboard.unknown') : <bdi dir="ltr">{row.model}</bdi>}</td>
                        <td>{timeLabel(row.updatedAt, now, t)}</td>
                        <td className={css.number}>{NUMBERS.format(row.turns)}</td>
                        <td className={css.number}>{NUMBERS.format(row.steps)}</td>
                        <td className={css.number}>{NUMBERS.format(row.outputTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <p className={css.note}>{t('dashboard.note')}</p>
      </div>
    </div>
  )
}

/**
 * Local Dashboard: session and workspace totals folded from the projections
 * the browser already holds. Spend is reported only through the versioned
 * pricing catalog, so an unpriced route stays visibly unknown.
 */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { SessionListState, SessionSummary } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceSnapshot } from '@greeneek/gnk-api-workspace-controller/client'
// Type-only: merges the sessionStats, modelSelection, tokenUsage, and agentPreset projection keys.
import type {} from '@greeneek/gnk-session-stats/client'
import type {} from '@greeneek/gnk-token-meter/client'
import { IconCloseOutline16 } from '@greeneek/gnk-client-ui-primitives'
import { dashboardFacts, type DashboardMetric, type DashboardSession } from './dashboard-model.ts'
import { SHIPPED_PRICING_CATALOG, type DashboardPricingCatalog } from './dashboard-pricing.ts'
import { timeLabel } from './time.ts'
import css from './DashboardPage.module.css'

/** Registration-side face: return to the mounted conversation. */
export interface DashboardPageInjected {
  /** Close the Dashboard page. */
  close: () => void
  /**
   * Price catalog the page reports spend against. The registration omits it,
   * so the shipped (empty, therefore always-honest) catalog applies.
   */
  pricing?: DashboardPricingCatalog
}

/** Full page props. */
export type DashboardPageProps =
  PropsRuntime<'dashboard'>
  & PropsLocale<'workspace'>
  & InjectFace<DashboardPageInjected>

/** Western digits only; the plan forbids Eastern Arabic numerals. */
const NUMBERS = new Intl.NumberFormat('en-US')

/** Spend keeps up to six decimals so a fraction of a cent stays visible. */
const MONETARY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })

/** Rows per page in the session detail table. */
const PAGE_SIZE = 8

/** Reduce one live session row to dashboard inputs. */
function dashboardSession(session: SessionSummary, workspace: string): DashboardSession {
  const values = session.projectionValues
  const selection = values?.modelSelection
  const next = selection?.next ?? selection?.lastUsed
  const stats = values?.sessionStats
  const usage = values?.tokenUsage
  const preset = values?.agentPreset
  return {
    id: session.id,
    title: session.displayTitle,
    running: session.running,
    updatedAt: session.updatedAt,
    workspace,
    ...(next === null || next === undefined ? {} : { provider: next.provider, model: next.model }),
    ...(preset === null || preset === undefined ? {} : { preset }),
    ...(session.origin === 'subagent' ? { subagent: true } : {}),
    // A row that has not received any projection is unmeasured, not zero.
    recorded: values !== undefined,
    turns: stats?.turns ?? 0,
    steps: stats?.steps ?? 0,
    inputTokens: usage?.uncachedInputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? stats?.decodeTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
  }
}

/**
 * Render the Dashboard page.
 * @param props - standard session/workspace hooks, dictionary, and the close action.
 * @returns the full-height local summary.
 */
export function DashboardPage({ useSessions, useWorkspaces, t, close, pricing }: DashboardPageProps) {
  const list: SessionListState = useSessions(state => state)
  const workspaces: WorkspaceSnapshot = useWorkspaces(state => state)
  const [metric, setMetric] = useState<DashboardMetric>('count')
  const [routeFilter, setRouteFilter] = useState('')
  const [page, setPage] = useState(0)
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
    pricing: pricing ?? SHIPPED_PRICING_CATALOG,
    metric,
  })
  const costValue = facts.cost.kind === 'known'
    ? t('dashboard.costKnown', {
      amount: MONETARY.format(facts.cost.amount),
      currency: facts.cost.currency,
    })
    : t('dashboard.costUnknown')
  const costReason = facts.cost.kind === 'known'
    ? t('dashboard.catalog', { version: facts.catalogVersion })
    : facts.cost.reason === 'mixed-currency'
      ? t('dashboard.costMixed')
      : facts.cost.reason === 'no-recorded-usage'
        ? t('dashboard.costNoUsage')
        : t('dashboard.costNoCatalog')
  const cards: readonly { key: string; label: string; value: string; detail?: string; unknown?: boolean }[] = [
    { key: 'sessions', label: t('dashboard.sessions'), value: NUMBERS.format(facts.sessions) },
    { key: 'workspaces', label: t('dashboard.workspaces'), value: NUMBERS.format(facts.workspaces) },
    { key: 'running', label: t('dashboard.running'), value: NUMBERS.format(facts.running) },
    { key: 'subagents', label: t('dashboard.subagents'), value: NUMBERS.format(facts.subagents) },
    { key: 'turns', label: t('dashboard.turns'), value: NUMBERS.format(facts.turns) },
    { key: 'steps', label: t('dashboard.steps'), value: NUMBERS.format(facts.steps) },
    { key: 'inputTokens', label: t('dashboard.inputTokens'), value: NUMBERS.format(facts.inputTokens) },
    { key: 'outputTokens', label: t('dashboard.outputTokens'), value: NUMBERS.format(facts.outputTokens) },
    { key: 'cacheRead', label: t('dashboard.cacheRead'), value: NUMBERS.format(facts.cacheReadTokens) },
    {
      key: 'cost',
      label: t('dashboard.cost'),
      value: costValue,
      detail: costReason,
      unknown: facts.cost.kind === 'unknown',
    },
  ]
  const metricValue = (entry: { readonly count: number; readonly tokens: number }): string =>
    NUMBERS.format(metric === 'tokens' ? entry.tokens : entry.count)
  const scaleOf = (entry: { readonly count: number; readonly tokens: number }): number =>
    metric === 'tokens' ? entry.tokens : entry.count
  const topModel = facts.models[0]
  const scale = Math.max(1, topModel === undefined ? 1 : scaleOf(topModel))
  const routeOptions = facts.models.map(model => model.route)
  const filteredRows = routeFilter === ''
    ? facts.rows
    : facts.rows.filter(row => row.model === routeFilter)
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  // A filter change can strand the page past the end; clamping keeps the render
  // a pure function of the inputs instead of resetting through an effect.
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filteredRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)
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

        {facts.dataState === 'partial'
          ? (
            <p className={css.notice} role="status">
              {t('dashboard.partial', { count: NUMBERS.format(facts.unmeasured) })}
            </p>
          )
          : null}

        <section className={css.stats}>
          {cards.map(card => (
            <article className={css.stat} key={card.key}>
              <span className={css.statLabel}>{card.label}</span>
              <span className={card.unknown === true ? css.statUnknown : css.statValue}>{card.value}</span>
              {card.detail === undefined
                ? null
                : <span className={css.statDetail}>{card.detail}</span>}
            </article>
          ))}
        </section>

        {facts.dataState === 'empty'
          ? (
            <section className={css.section}>
              <h2 className={css.sectionTitle}>{t('dashboard.emptyTitle')}</h2>
              <p className={css.empty}>{t('dashboard.emptyHint')}</p>
            </section>
          )
          : (
            <>
              <div className={css.rankRow} role="group" aria-label={t('dashboard.metric')}>
                <button
                  type="button"
                  className={metric === 'count' ? css.rankActive : css.rank}
                  aria-pressed={metric === 'count'}
                  onClick={() => { setMetric('count') }}
                >
                  {t('dashboard.metricCount')}
                </button>
                <button
                  type="button"
                  className={metric === 'tokens' ? css.rankActive : css.rank}
                  aria-pressed={metric === 'tokens'}
                  onClick={() => { setMetric('tokens') }}
                >
                  {t('dashboard.metricTokens')}
                </button>
              </div>

              <section className={css.section}>
                <h2 className={css.sectionTitle}>{t('dashboard.models')}</h2>
                {facts.models.length === 0
                  ? <p className={css.empty}>{t('dashboard.modelsEmpty')}</p>
                  : (
                    <ul className={css.models} aria-label={t('dashboard.usageAria')}>
                      {facts.models.map(usage => (
                        <li className={css.modelRow} key={usage.route}>
                          <span className={css.modelRoute} dir="ltr">{usage.route}</span>
                          <span className={css.modelCount}>{metricValue(usage)}</span>
                          <span className={css.modelTrack} aria-hidden="true">
                            <span
                              className={css.modelFill}
                              style={{ inlineSize: `${Math.max(4, Math.round((scaleOf(usage) / scale) * 100))}%` }}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </section>

              <div className={css.columns}>
                <section className={css.section}>
                  <h2 className={css.sectionTitle}>{t('dashboard.providers')}</h2>
                  {facts.providers.length === 0
                    ? <p className={css.empty}>{t('dashboard.providersEmpty')}</p>
                    : (
                      <ul className={css.plainList} aria-label={t('dashboard.providers')}>
                        {facts.providers.map(entry => (
                          <li className={css.plainRow} key={entry.provider}>
                            <bdi dir="ltr">{entry.provider}</bdi>
                            <span className={css.plainCount}>{metricValue(entry)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                </section>

                <section className={css.section}>
                  <h2 className={css.sectionTitle}>{t('dashboard.presets')}</h2>
                  {facts.presets.length === 0
                    ? <p className={css.empty}>{t('dashboard.presetsEmpty')}</p>
                    : (
                      <ul className={css.plainList} aria-label={t('dashboard.presets')}>
                        {facts.presets.map(entry => (
                          <li className={css.plainRow} key={entry.preset}>
                            <bdi dir="ltr">{entry.preset}</bdi>
                            <span className={css.plainCount}>{metricValue(entry)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                </section>
              </div>

              <section className={css.section}>
                <div className={css.sectionHead}>
                  <h2 className={css.sectionTitle}>{t('dashboard.recent')}</h2>
                  <label className={css.filterLabel}>
                    <span className={css.filterCaption}>{t('dashboard.filter')}</span>
                    <select
                      className={css.filter}
                      value={routeFilter}
                      onChange={(event) => { setRouteFilter(event.target.value); setPage(0) }}
                    >
                      <option value="">{t('dashboard.filterAll')}</option>
                      {routeOptions.map(route => <option key={route} value={route}>{route}</option>)}
                    </select>
                  </label>
                </div>
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
                        <th className={css.number}>{t('dashboard.inputTokens')}</th>
                        <th className={css.number}>{t('dashboard.outputTokens')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(row => (
                        <tr key={row.id}>
                          <td><span dir="auto">{row.title}</span></td>
                          <td><span dir="auto">{row.workspace}</span></td>
                          <td>{row.model === undefined ? t('dashboard.unknown') : <bdi dir="ltr">{row.model}</bdi>}</td>
                          <td>{timeLabel(row.updatedAt, now, t)}</td>
                          <td className={css.number}>
                            {row.recorded ? NUMBERS.format(row.turns) : t('dashboard.unknown')}
                          </td>
                          <td className={css.number}>
                            {row.recorded ? NUMBERS.format(row.steps) : t('dashboard.unknown')}
                          </td>
                          <td className={css.number}>
                            {row.recorded ? NUMBERS.format(row.inputTokens) : t('dashboard.unknown')}
                          </td>
                          <td className={css.number}>
                            {row.recorded ? NUMBERS.format(row.outputTokens) : t('dashboard.unknown')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={css.pager}>
                  <button
                    type="button"
                    className={css.pagerButton}
                    disabled={currentPage === 0}
                    onClick={() => { setPage(currentPage - 1) }}
                  >
                    {t('dashboard.previous')}
                  </button>
                  <span className={css.pagerLabel} aria-live="polite">
                    {t('dashboard.page', {
                      page: NUMBERS.format(currentPage + 1),
                      pages: NUMBERS.format(pageCount),
                    })}
                  </span>
                  <button
                    type="button"
                    className={css.pagerButton}
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => { setPage(currentPage + 1) }}
                  >
                    {t('dashboard.next')}
                  </button>
                </div>
              </section>
            </>
          )}

        <p className={css.note}>{t('dashboard.note')}</p>
      </div>
    </div>
  )
}

/**
 * Pull request surfaces: real PR lists from the Host GitHub integration. The
 * linked variant searches PRs whose head branch matches the current Workspace
 * branch. Every row is data from GitHub; the browser never navigates to it.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PullRequestsSurfaceProps } from './contract.ts'
import css from './PullRequestsPanel.module.css'

/** Page size used by both PR surfaces. */
const PAGE_SIZE = 30

/**
 * Render one PR surface.
 * @param props - workspace, configuration, load callbacks and locale.
 * @returns the PR list or its loading/empty/error state.
 */
export function PullRequestsPanel({
  cwd, configured, load, repository, branch, t, linked,
}: PullRequestsSurfaceProps & { linked: boolean }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof load>>['items']>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (targetPage: number) => {
    if (cwd === undefined) return
    setLoading(true)
    setError(undefined)
    try {
      const repo = await repository(cwd)
      const head = linked ? await branch(cwd) : undefined
      const result = await load({
        owner: repo.owner, repo: repo.repo,
        ...(head === undefined ? {} : { branch: head }),
        page: targetPage, perPage: PAGE_SIZE,
      })
      setRows(current => targetPage === 1 ? result.items : [...current, ...result.items])
      setHasNext(result.hasNext)
      setPage(targetPage)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [branch, cwd, linked, load, repository])

  useEffect(() => { void refresh(1) }, [refresh])

  if (!configured) return <div className={css.notice}>{t('pr.unconfigured')}</div>
  if (cwd === undefined) return <div className={css.notice}>{t('pr.noWorkspace')}</div>
  if (error !== undefined) return <div className={css.error} role="alert">{error}</div>

  return (
    <div className={css.root}>
      <h3 className={css.heading}>{linked ? t('surface.linkedPullRequests') : t('surface.pullRequest')}</h3>
      {rows.length === 0 && !loading && <div className={css.notice}>{t('pr.empty')}</div>}
      {rows.map(row => (
        <div key={`${row.number}-${row.url}`} className={css.row}>
          <span className={css.number}>#{row.number}</span>
          <div className={css.body}>
            <div className={css.title}>{row.title}</div>
            <div className={css.meta}>{row.state} · {row.branch} · {row.author}{row.draft ? ` · ${t('pr.draft')}` : ''}</div>
            <div className={css.url}>{row.url}</div>
          </div>
        </div>
      ))}
      {hasNext && (
        <button type="button" className={css.more} onClick={() => { void refresh(page + 1) }} disabled={loading}>
          {t('pr.more')}
        </button>
      )}
      {loading && <div className={css.notice}>{t('surface.loading')}</div>}
    </div>
  )
}

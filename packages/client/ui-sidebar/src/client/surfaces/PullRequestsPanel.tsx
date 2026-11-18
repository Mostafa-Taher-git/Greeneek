/**
 * Pull request surfaces: real PR lists and details from the Host GitHub
 * integration. The linked variant searches PRs whose head branch matches the
 * current Workspace branch. All content is data from GitHub; the browser never
 * navigates to the external site.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PullRequestDetail, PullRequestsSurfaceProps } from './contract.ts'
import css from './PullRequestsPanel.module.css'

/** Page size used by both PR surfaces. */
const PAGE_SIZE = 30

type Repo = { owner: string; repo: string }

/**
 * Render one PR surface, including its detail view.
 * @param props - workspace, configuration, load/detail/action callbacks, locale.
 * @returns the list or the selected PR detail.
 */
export function PullRequestsPanel({
  cwd, configured, load, repository, branch, detail, action, t, linked,
}: PullRequestsSurfaceProps & { linked: boolean }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof load>>['items']>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [repo, setRepo] = useState<Repo>()
  const [selected, setSelected] = useState<PullRequestDetail>()
  const [confirm, setConfirm] = useState<'merge' | 'close'>()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (targetPage: number) => {
    if (cwd === undefined) return
    setLoading(true)
    setError(undefined)
    try {
      const resolved = await repository(cwd)
      setRepo(resolved)
      const head = linked ? await branch(cwd) : undefined
      const result = await load({
        owner: resolved.owner, repo: resolved.repo,
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

  const openDetail = (number: number): void => {
    if (repo === undefined) return
    setError(undefined)
    setLoading(true)
    detail({ ...repo, number })
      .then((value) => { setSelected(value) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setLoading(false) })
  }

  const runAction = (kind: 'merge' | 'close'): void => {
    if (repo === undefined || selected === undefined) return
    setBusy(true)
    setError(undefined)
    action({ ...repo, number: selected.number, action: kind })
      .then(() => {
        setConfirm(undefined)
        return detail({ ...repo, number: selected.number })
      })
      .then((value) => { setSelected(value) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setBusy(false) })
  }

  if (!configured) return <div className={css.notice}>{t('pr.unconfigured')}</div>
  if (cwd === undefined) return <div className={css.notice}>{t('pr.noWorkspace')}</div>
  if (error !== undefined) return <div className={css.error} role="alert">{error}</div>

  if (selected !== undefined) {
    return (
      <div className={css.root}>
        <button type="button" className={css.back} onClick={() => { setSelected(undefined) }}>
          {t('pr.back')}
        </button>
        <h3 className={css.heading}>#{selected.number} {selected.title}</h3>
        <div className={css.meta}>
          {selected.state} · {selected.branch} → {selected.baseBranch} · {selected.author}
          {selected.draft ? ` · ${t('pr.draft')}` : ''}
          {selected.merged ? ` · ${t('pr.merged')}` : ''}
        </div>
        {selected.body !== '' && <pre className={css.text}>{selected.body}</pre>}
        <h4 className={css.subheading}>{t('pr.checks')}</h4>
        {selected.checks.length === 0
          ? <div className={css.notice}>{t('pr.empty')}</div>
          : selected.checks.map(check => (
            <div key={check.name} className={css.meta}>{check.name}: {check.conclusion}</div>
          ))}
        <h4 className={css.subheading}>{t('pr.files')}</h4>
        {selected.files.length === 0
          ? <div className={css.notice}>{t('pr.empty')}</div>
          : selected.files.map(file => (
            <div key={file.path} className={css.meta}>
              {file.status} {file.path} +{file.additions} −{file.deletions}
            </div>
          ))}
        <h4 className={css.subheading}>{t('pr.comments')}</h4>
        {selected.comments.length === 0
          ? <div className={css.notice}>{t('pr.empty')}</div>
          : selected.comments.map((comment, index) => (
            <div key={`${comment.createdAt}-${index}`} className={css.comment}>
              <span className={css.meta}>{comment.author}</span>
              <pre className={css.text}>{comment.body}</pre>
            </div>
          ))}
        {selected.merged || selected.state === 'closed' ? null : (
          <div className={css.actions}>
            <button type="button" className={css.more} disabled={busy} onClick={() => { setConfirm('merge') }}>
              {t('pr.merge')}
            </button>
            <button type="button" className={css.more} disabled={busy} onClick={() => { setConfirm('close') }}>
              {t('pr.close')}
            </button>
          </div>
        )}
        {confirm !== undefined && (
          <div className={css.confirm}>
            <span>{t('pr.confirm')} {confirm}?</span>
            <button type="button" className={css.more} disabled={busy} onClick={() => { runAction(confirm) }}>
              {t('browser.go')}
            </button>
            <button type="button" className={css.more} disabled={busy} onClick={() => { setConfirm(undefined) }}>
              {t('pr.cancel')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={css.root}>
      <h3 className={css.heading}>{linked ? t('surface.linkedPullRequests') : t('surface.pullRequest')}</h3>
      {rows.length === 0 && !loading && <div className={css.notice}>{t('pr.empty')}</div>}
      {rows.map(row => (
        <button
          key={`${row.number}-${row.url}`}
          type="button"
          className={css.rowButton}
          onClick={() => { openDetail(row.number) }}
        >
          <span className={css.number}>#{row.number}</span>
          <span className={css.body}>
            <span className={css.title}>{row.title}</span>
            <span className={css.meta}>{row.state} · {row.branch} · {row.author}{row.draft ? ` · ${t('pr.draft')}` : ''}</span>
            <span className={css.url}>{row.url}</span>
          </span>
        </button>
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

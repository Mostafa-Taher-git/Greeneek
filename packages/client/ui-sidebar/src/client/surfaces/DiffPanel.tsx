/**
 * Diff surface: the Host's read-only unified change set for the current
 * Workspace, rendered file by file. No browser code shells out to git.
 */
import { useEffect, useState } from 'react'
import type { DiffSurfaceProps, DiffView } from './contract.ts'
import css from './DiffPanel.module.css'

/**
 * Render the Diff surface.
 * @param props - workspace path, Host diff callback, locale seat.
 * @returns the change set or its loading/empty/error state.
 */
export function DiffPanel({ cwd, loadDiff, t }: DiffSurfaceProps) {
  const [view, setView] = useState<DiffView>()
  const [error, setError] = useState<string>()
  const [expanded, setExpanded] = useState<string>()

  useEffect(() => {
    let live = true
    setView(undefined)
    setError(undefined)
    if (cwd === undefined) return () => { live = false }
    loadDiff(cwd)
      .then((value) => { if (live) setView(value) })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [cwd, loadDiff])

  if (cwd === undefined) return <div className={css.notice}>{t('diff.noWorkspace')}</div>
  if (error !== undefined) return <div className={css.error} role="alert">{error}</div>
  if (view === undefined) return <div className={css.notice}>{t('surface.loading')}</div>
  if (!view.isRepository) return <div className={css.notice}>{t('diff.notRepository')}</div>

  return (
    <div className={css.root}>
      <div className={css.summary}>
        {t('diff.against')} {view.baseBranch ?? t('diff.head')} · {view.files.length} {t('diff.files')}
      </div>
      {view.files.length === 0 && <div className={css.notice}>{t('diff.clean')}</div>}
      {view.files.map(file => (
        <div key={file.path} className={css.file}>
          <button
            type="button"
            className={css.fileButton}
            aria-expanded={expanded === file.path}
            onClick={() => { setExpanded(current => current === file.path ? undefined : file.path) }}
          >
            <span className={css.status}>{file.status}</span>
            <span className={css.path}>{file.path}</span>
          </button>
          {expanded === file.path && (
            file.patch === '' ? <div className={css.notice}>{t('diff.noPatch')}</div>
              : <pre className={css.patch}>{file.patch}</pre>
          )}
        </div>
      ))}
      {view.truncated && <div className={css.notice}>{t('diff.truncated')}</div>}
    </div>
  )
}

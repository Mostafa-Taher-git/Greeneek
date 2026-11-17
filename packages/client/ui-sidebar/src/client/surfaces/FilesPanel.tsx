/**
 * Files surface: a bounded Host directory browser backed by `ctx.remote.files`.
 * Every row navigates a real path; file rows show a bounded UTF-8 read. No
 * browser code touches the filesystem directly.
 */
import { useCallback, useEffect, useState } from 'react'
import { IconFolderOpenOutline16 } from '@greeneek/gnk-client-ui-primitives'
import type { FilesSurfaceProps } from './contract.ts'
import css from './FilesPanel.module.css'

/**
 * Render the Files surface.
 * @param props - browse/read callbacks and the locale seat.
 * @returns crumbs, directory rows, and the selected file's text.
 */
export function FilesPanel({ browseFiles, readFile, t }: FilesSurfaceProps) {
  const [listing, setListing] = useState<Awaited<ReturnType<typeof browseFiles>>>()
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<{ path: string; text: string; binary: boolean }>()
  const [loading, setLoading] = useState(false)

  const load = useCallback((path: string | undefined) => {
    setLoading(true)
    setError(undefined)
    setSelected(undefined)
    browseFiles(path)
      .then((value) => { setListing(value) })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setLoading(false) })
  }, [browseFiles])

  useEffect(() => { load(undefined) }, [load])

  const openRow = (kind: 'directory' | 'file', path: string): void => {
    if (kind === 'directory') { load(path); return }
    setLoading(true)
    setError(undefined)
    readFile(path)
      .then((value) => { setSelected({ path, text: value.text, binary: value.binary }) })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setLoading(false) })
  }

  if (error !== undefined) return <div className={css.error} role="alert">{error}</div>

  return (
    <div className={css.root}>
      {listing !== undefined && (
        <>
          <div className={css.crumbs}>
            {listing.crumbs.map(crumb => (
              <button key={crumb.path} type="button" className={css.crumb} onClick={() => { load(crumb.path) }}>
                {crumb.name}
              </button>
            ))}
          </div>
          <div className={css.rows}>
            {listing.entries.map(entry => (
              <button
                key={entry.path}
                type="button"
                className={css.row}
                onClick={() => { openRow(entry.kind, entry.path) }}
              >
                {entry.kind === 'directory' && <IconFolderOpenOutline16 className={css.icon} />}
                <span className={css.name}>{entry.name}</span>
              </button>
            ))}
          </div>
          {listing.truncated && <div className={css.notice}>{t('files.truncated')}</div>}
        </>
      )}
      {selected !== undefined && (
        <div className={css.file}>
          <div className={css.fileName}>{selected.path}</div>
          {selected.binary
            ? <div className={css.notice}>{t('files.binary')}</div>
            : <pre className={css.text}>{selected.text}</pre>}
        </div>
      )}
      {loading && <div className={css.notice}>{t('surface.loading')}</div>}
    </div>
  )
}

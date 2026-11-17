/**
 * Device surface: the Host facts Greeneek already owns — machine name, home
 * directory, loopback flag, platform, and the installed-application catalogue.
 * The data is fetched through the inject callback; no browser code reads a
 * Host service directly.
 */
import { useEffect, useState } from 'react'
import { IconCopyOutline16, writeClipboard } from '@greeneek/gnk-client-ui-primitives'
import type { DeviceSurfaceProps } from './contract.ts'
import css from './DevicePanel.module.css'

/**
 * Render the Device surface.
 * @param props - the surface inject face and locale seat.
 * @returns the Host fact rows, or its loading/error state.
 */
export function DevicePanel({ loadDevice, t }: DeviceSurfaceProps) {
  const [facts, setFacts] = useState<Awaited<ReturnType<typeof loadDevice>>>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    setFacts(undefined)
    setError(undefined)
    loadDevice()
      .then((value) => { if (live) setFacts(value) })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { live = false }
  }, [loadDevice])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [copied])

  if (error !== undefined) return <div className={css.error} role="alert">{error}</div>
  if (facts === undefined) return <div className={css.notice}>{t('surface.loading')}</div>

  return (
    <div className={css.root}>
      <div className={css.row}>
        <span className={css.label}>{t('device.hostname')}</span>
        <span className={css.value}>{facts.hostname ?? t('device.unknown')}</span>
        <button
          type="button"
          className={css.copy}
          aria-label={t('device.copy')}
          onClick={() => {
            void writeClipboard(facts.hostname ?? '').then((accepted) => { if (accepted) setCopied(true) })
          }}
        >
          <IconCopyOutline16 />
        </button>
      </div>
      <div className={css.row}>
        <span className={css.label}>{t('device.platform')}</span>
        <span className={css.value}>{facts.platform}</span>
      </div>
      <div className={css.row}>
        <span className={css.label}>{t('device.home')}</span>
        <span className={css.value}>{facts.home ?? t('device.unknown')}</span>
      </div>
      <div className={css.row}>
        <span className={css.label}>{t('device.connection')}</span>
        <span className={css.value}>{facts.isLoopback ? t('device.local') : t('device.remote')}</span>
      </div>
      <h3 className={css.heading}>{t('device.apps')}</h3>
      {facts.apps.length === 0
        ? <div className={css.notice}>{t('device.noApps')}</div>
        : (
          <ul className={css.apps}>
            {facts.apps.map(app => <li key={app.id}>{app.label}</li>)}
          </ul>
        )}
      {copied && <span className={css.copied} role="status">{t('device.copied')}</span>}
    </div>
  )
}

/**
 * Desktop-native Browser surface. The guest page runs in an Electron webview
 * whose partition is validated by the main process; Default persists storage,
 * Incognito uses a non-persistent partition. No in-app navigation is performed
 * by the host window itself, and the host window's security policy is unchanged.
 */
import { createElement, useState, type FormEvent } from 'react'
import type { BrowserSurfaceProps } from './contract.ts'
import css from './BrowserPanel.module.css'

/** Validate a browser address: only http(s) in the guest. */
function guestUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Render the Browser surface.
 * @param props - profile, desktop flag, locale.
 * @returns the address bar and the isolated guest view.
 */
export function BrowserPanel({ profile, desktop, t }: BrowserSurfaceProps) {
  const [input, setInput] = useState('https://github.com')
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const partition = profile === 'incognito' ? 'gnk-browser-incognito' : 'persist:gnk-browser-default'

  if (!desktop) return <div className={css.notice}>{t('browser.desktopOnly')}</div>

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const next = guestUrl(input)
    if (next === undefined) { setError(t('browser.invalidUrl')); return }
    setError(undefined)
    setUrl(next)
  }

  return (
    <div className={css.root}>
      <form className={css.bar} onSubmit={submit}>
        <input
          className={css.input}
          value={input}
          aria-label={t('browser.address')}
          onChange={(event) => { setInput(event.target.value) }}
        />
        <button type="submit" className={css.go}>{t('browser.go')}</button>
      </form>
      <div className={css.profile}>{profile === 'incognito' ? t('surface.profile.incognito') : t('surface.profile.default')}</div>
      {error !== undefined && <div className={css.error} role="alert">{error}</div>}
      <div className={css.guest}>
        {url === undefined
          ? <div className={css.notice}>{t('browser.empty')}</div>
          : createElement('webview', {
            key: url,
            src: url,
            partition,
            webpreferences: 'sandbox=1,nodeIntegration=0,contextIsolation=1',
            allowpopups: false,
            className: css.webview,
          })}
      </div>
    </div>
  )
}

/**
 * Browser surface with two carriers. Desktop embeds a Host-validated Electron
 * webview with isolated partitions. Web uses a strictly validated, sandboxed
 * iframe with an application-known history and an explicit external-browser
 * escape hatch; the host window never navigates to a guest origin.
 */
import { createElement, useState, type FormEvent } from 'react'
import type { BrowserSurfaceProps } from './contract.ts'
import css from './BrowserPanel.module.css'

/** Maximum accepted guest address length, matching the reference carrier. */
const MAX_BROWSER_URL_LENGTH = 16 * 1024

/** Validate a browser address: only http(s), bounded, no credentials, not our own origin. */
function guestUrl(value: string): string | undefined {
  const text = value.trim()
  if (text.length === 0 || text.length > MAX_BROWSER_URL_LENGTH) return undefined
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (parsed.username !== '' || parsed.password !== '') return undefined
    if (typeof location !== 'undefined' && parsed.origin === location.origin) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

/**
 * Render the Browser surface.
 * @param props - profile, desktop flag, locale.
 * @returns the address bar, navigation controls and the isolated guest view.
 */
export function BrowserPanel({ profile, desktop, t }: BrowserSurfaceProps) {
  const [input, setInput] = useState('https://github.com')
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<readonly string[]>([])
  const [cursor, setCursor] = useState(-1)
  const [reloadKey, setReloadKey] = useState(0)
  const partition = profile === 'incognito' ? 'gnk-browser-incognito' : 'persist:gnk-browser-default'

  const navigate = (next: string): void => {
    const trimmed = history.slice(0, cursor + 1)
    setHistory([...trimmed, next])
    setCursor(trimmed.length)
    setUrl(next)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const next = guestUrl(input)
    if (next === undefined) { setError(t('browser.invalidUrl')); return }
    setError(undefined)
    navigate(next)
  }

  const openExternal = (target: string | undefined): void => {
    if (target === undefined) return
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  const controls = desktop ? null : (
    <div className={css.nav}>
      <button type="button" className={css.navButton} disabled={cursor <= 0}
        aria-label={t('browser.back')}
        onClick={() => { const next = history[cursor - 1]; if (next !== undefined) { setCursor(cursor - 1); setUrl(next) } }}>
        ‹
      </button>
      <button type="button" className={css.navButton} disabled={cursor < 0 || cursor >= history.length - 1}
        aria-label={t('browser.forward')}
        onClick={() => { const next = history[cursor + 1]; if (next !== undefined) { setCursor(cursor + 1); setUrl(next) } }}>
        ›
      </button>
      <button type="button" className={css.navButton} disabled={url === undefined}
        aria-label={t('browser.reload')}
        onClick={() => { setReloadKey(value => value + 1) }}>
        ↻
      </button>
      <button type="button" className={css.navButton} disabled={url === undefined}
        aria-label={t('browser.openExternal')}
        onClick={() => { openExternal(url) }}>
        ↗
      </button>
    </div>
  )

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
      {controls}
      <div className={css.profile}>
        {profile === 'incognito' ? t('surface.profile.incognito') : t('surface.profile.default')}
        {!desktop && <span className={css.profileNote}>{t('browser.profileWebNote')}</span>}
      </div>
      {error !== undefined && <div className={css.error} role="alert">{error}</div>}
      {!desktop && <p className={css.note}>{t('browser.embedNote')}</p>}
      <div className={css.guest}>
        {url === undefined
          ? <div className={css.notice}>{t('browser.empty')}</div>
          : desktop
            ? createElement('webview', {
              key: url,
              src: url,
              partition,
              webpreferences: 'sandbox=1,nodeIntegration=0,contextIsolation=1',
              allowpopups: false,
              className: css.webview,
            })
            : (
              <iframe
                key={`${url}:${reloadKey}`}
                src={url}
                title={t('browser.title')}
                className={css.webview}
                sandbox="allow-scripts allow-forms allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
              />
            )}
      </div>
    </div>
  )
}

/**
 * Browser surface with two carriers. Desktop embeds a Host-validated Electron
 * webview with isolated partitions. Web uses a strictly validated, sandboxed
 * iframe. The chrome row mirrors the reference panel browser: navigation,
 * a single address field, recently-used shortcuts, and an external escape.
 */
import { createElement, useState, type FormEvent } from 'react'
import type { BrowserSurfaceProps } from './contract.ts'
import css from './BrowserPanel.module.css'

/** Maximum accepted guest address length. */
const MAX_BROWSER_URL_LENGTH = 16 * 1024
/** Storage key for the local recently-used list. */
const RECENTS_KEY = 'gnk.browser.recents.v1'
/** Maximum recents shown in the empty state. */
const MAX_RECENTS = 8

interface Recent {
  readonly url: string
  readonly title: string
  readonly at: number
}

/** Read the recent visits from local storage without throwing on bad data. */
function loadRecents(): readonly Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as Recent[]
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item.url === 'string').slice(0, MAX_RECENTS)
      : []
  } catch {
    return []
  }
}

/** Persist one visit at the head of the recent list. */
function recordVisit(url: string): readonly Recent[] {
  try {
    let host = url
    try { host = new URL(url).hostname } catch { /* keep raw */ }
    const rest = loadRecents().filter(item => item.url !== url)
    const next = [{ url, title: host, at: Date.now() }, ...rest].slice(0, MAX_RECENTS)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    return next
  } catch {
    return loadRecents()
  }
}

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

/** Render the Browser surface with a full-chrome address bar and recents. */
export function BrowserPanel({ profile, desktop, t }: BrowserSurfaceProps) {
  const [input, setInput] = useState('')
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<readonly string[]>([])
  const [cursor, setCursor] = useState(-1)
  const [reloadKey, setReloadKey] = useState(0)
  const [recents, setRecents] = useState<readonly Recent[]>(loadRecents)
  const partition = profile === 'incognito' ? 'gnk-browser-incognito' : 'persist:gnk-browser-default'

  const navigate = (next: string): void => {
    const trimmed = history.slice(0, cursor + 1)
    setHistory([...trimmed, next])
    setCursor(trimmed.length)
    setUrl(next)
    setInput(next)
    setRecents(recordVisit(next))
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const next = guestUrl(input)
    if (next === undefined) { setError(t('browser.invalidUrl')); return }
    setError(undefined)
    navigate(next)
  }

  const goTo = (target: string): void => { setError(undefined); navigate(target) }

  return (
    <div className={css.root}>
      <div className={css.chrome}>
        <div className={css.navGroup}>
          <button type="button" className={css.navButton} disabled={cursor <= 0}
            aria-label={t('browser.back')}
            onClick={() => {
              const next = history[cursor - 1]
              if (next !== undefined) { setCursor(cursor - 1); setUrl(next); setInput(next) }
            }}>
            ‹
          </button>
          <button type="button" className={css.navButton} disabled={cursor < 0 || cursor >= history.length - 1}
            aria-label={t('browser.forward')}
            onClick={() => {
              const next = history[cursor + 1]
              if (next !== undefined) { setCursor(cursor + 1); setUrl(next); setInput(next) }
            }}>
            ›
          </button>
          <button type="button" className={css.navButton} disabled={url === undefined}
            aria-label={t('browser.reload')}
            onClick={() => { setReloadKey(value => value + 1) }}>
            ↻
          </button>
        </div>
        <form className={css.bar} onSubmit={submit}>
          <input
            className={css.input}
            value={input}
            aria-label={t('browser.address')}
            placeholder={t('browser.searchPlaceholder')}
            onChange={(event) => { setInput(event.target.value) }}
          />
        </form>
        <div className={css.toolGroup}>
          <button type="button" className={css.navButton} disabled={url === undefined}
            aria-label={t('browser.openExternal')}
            title={t('browser.openExternal')}
            onClick={() => { if (url !== undefined) window.open(url, '_blank', 'noopener,noreferrer') }}>
            ↗
          </button>
        </div>
      </div>
      <div className={css.profile}>
        {profile === 'incognito' ? t('surface.profile.incognito') : t('surface.profile.default')}
      </div>
      {error !== undefined && <div className={css.error} role="alert">{error}</div>}
      {!desktop && url !== undefined && <p className={css.note}>{t('browser.embedNote')}</p>}
      <div className={css.guest}>
        {url === undefined
          ? (
            <div className={css.emptyState}>
              <h2 className={css.emptyHeading}>{t('browser.recentlyUsed')}</h2>
              {recents.length === 0
                ? <p className={css.notice}>{t('browser.empty')}</p>
                : (
                  <div className={css.recentList}>
                    {recents.map(recent => (
                      <button key={recent.url} type="button" className={css.recentCard} onClick={() => { goTo(recent.url) }}>
                        <span className={css.recentFavicon}>🌐</span>
                        <span className={css.recentBody}>
                          <span className={css.recentTitle}>{recent.title}</span>
                          <span className={css.recentUrl}>{recent.url}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )
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

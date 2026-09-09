/**
 * About settings section: version facts plus the desktop update controls.
 * Inside Greeneek Desktop the page shows the installed versions with a
 * Check-for-updates button, a status line, and Restart-and-install once an
 * update is downloaded (consent dialogs stay native). In a plain browser tab
 * it shows the served version with a link to the desktop downloads instead.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
// Type-only: pulls the settings.section SlotMap merge (this section's seat)
// into the program — no runtime edge to ui-settings.
import type {} from '@greeneek/gnk-client-ui-settings/client'
import type { SettingsKey } from './locales.ts'
import { desktopBridge, webVersion, type DesktopBridge } from './desktop.ts'
import css from './AboutSection.module.css'

/** Full component props: the section seat plus the settings copy. */
export type AboutSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>

/** Download page for installable desktop builds. */
const DESKTOP_DOWNLOADS = 'https://www.greeneek.duckdns.org/downloads/'

/** Poll cadence while a check or download is in flight. */
const UPDATE_POLL_MS = 2_000

/** Update states that settle on their own; everything else keeps polling. */
const SETTLED_STATES = new Set(['idle', 'downloaded', 'up-to-date', 'error', 'unsupported'])

/** Status-line copy key per updater state; null renders no line. */
function statusKey(state: string): SettingsKey | null {
  switch (state) {
    case 'checking': return 'about.checking'
    case 'available': return 'about.available'
    case 'downloading': return 'about.downloading'
    case 'downloaded': return 'about.downloaded'
    case 'up-to-date': return 'about.upToDate'
    case 'error': return 'about.error'
    case 'unsupported': return 'about.unsupported'
    default: return null
  }
}

type Versions =
  | { readonly kind: 'desktop'; readonly desktop: string; readonly harness: unknown }
  | { readonly kind: 'web'; readonly version: string }
  | { readonly kind: 'unknown' }

/**
 * Render the About section content column.
 * @param props - section seat and settings copy.
 * @returns the section element tree.
 */
export function AboutSection({ t }: AboutSectionProps) {
  const [bridge] = useState<DesktopBridge | undefined>(() => desktopBridge())
  const [versions, setVersions] = useState<Versions>({ kind: 'unknown' })
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const poller = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    if (bridge === undefined) {
      const version = webVersion()
      setVersions(version === undefined ? { kind: 'unknown' } : { kind: 'web', version })
      return () => { live.current = false }
    }
    bridge.versions().then(
      ({ desktop, harness }) => { if (live.current) setVersions({ kind: 'desktop', desktop, harness }) },
      () => { if (live.current) setVersions({ kind: 'unknown' }) },
    )
    bridge.updateStatus().then(
      ({ state }) => { if (live.current) setStatus(state) },
      () => {},
    )
    return () => {
      live.current = false
      if (poller.current !== undefined) clearInterval(poller.current)
    }
  }, [bridge])

  const stopPolling = () => {
    if (poller.current !== undefined) {
      clearInterval(poller.current)
      poller.current = undefined
    }
  }

  const pollUntilSettled = () => {
    stopPolling()
    poller.current = setInterval(() => {
      if (bridge === undefined) return
      bridge.updateStatus().then(
        ({ state }) => {
          if (!live.current) return
          setStatus(state)
          if (SETTLED_STATES.has(state)) {
            stopPolling()
            setBusy(false)
          }
        },
        () => {
          if (!live.current) return
          stopPolling()
          setBusy(false)
          setStatus('error')
        },
      )
    }, UPDATE_POLL_MS)
  }

  const check = () => {
    if (bridge === undefined || busy) return
    setBusy(true)
    bridge.checkForUpdates().then(
      ({ state }) => {
        if (!live.current) return
        setStatus(state)
        if (SETTLED_STATES.has(state)) setBusy(false)
        else pollUntilSettled()
      },
      () => {
        if (!live.current) return
        setBusy(false)
        setStatus('error')
      },
    )
  }

  const restart = () => {
    if (bridge === undefined) return
    void bridge.installUpdate()
  }

  const versionRows = versions.kind === 'desktop'
    ? [
      { label: t('about.desktopVersion'), value: versions.desktop },
      {
        label: t('about.harnessVersion'),
        value: typeof versions.harness === 'string' && versions.harness !== ''
          ? versions.harness
          : t('about.unknown'),
      },
    ]
    : [{ label: t('about.webVersion'), value: versions.kind === 'web' ? versions.version : t('about.unknown') }]

  const line = status === null ? null : statusKey(status)

  return (
    <div className={css.section}>
      <p className={css.lead}>{t('about.lead')}</p>
      <ul className={css.rows}>
        {versionRows.map(row => (
          <li key={row.label} className={css.row}>
            <span className={css.name}>{row.label}</span>
            <span className={css.value}>{row.value}</span>
          </li>
        ))}
      </ul>
      {bridge === undefined
        ? (
          <p className={css.status}>
            <a className={css.link} href={DESKTOP_DOWNLOADS} target="_blank" rel="noreferrer">
              {t('about.getDesktop')}
            </a>
          </p>
        )
        : (
          <div className={css.actions}>
            <button type="button" className={css.button} disabled={busy} onClick={check}>
              {t('about.check')}
            </button>
            {status === 'downloaded' && (
              <button type="button" className={css.button} onClick={restart}>
                {t('about.restart')}
              </button>
            )}
            {line !== null && (
              <p className={css.status} role="status">{t(line)}</p>
            )}
          </div>
        )}
    </div>
  )
}

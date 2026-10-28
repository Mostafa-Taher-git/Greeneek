/**
 * Craft settings section — one row per pilot app, with its measured
 * installation state, a "Check installation" action, and the link that makes
 * sense for that state (download the vendor app, open the connected desktop
 * window, or launch it connected).
 *
 * The section reads through an injected {@link CraftSettingsSource}; without a
 * desktop bridge the composition injects the static pilot fallback, whose rows
 * report `unavailable` rather than a fabricated installation state. Loading,
 * failure, empty, and no-bridge each render an explicit status instead of an
 * empty list.
 */
import { useEffect, useState } from 'react'
import { StateDot } from '@greeneek/gnk-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
// Type-only: pulls the settings.section SlotMap merge (this section's seat)
// into the program — no runtime edge to ui-settings.
import type {} from '@greeneek/gnk-client-ui-settings/client'
import type { CraftAppView, CraftSettingsSource, CraftUiState } from '../contract.ts'
import type { CraftKey } from '../locales.ts'
import css from './CraftSection.module.css'

/** Registration-side data source used by the section. */
export interface CraftSectionInjected {
  /** Read every pilot app's current state. */
  readonly source: CraftSettingsSource
}

/** Full component props assembled by the Settings slot renderer. */
export type CraftSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'craft'>
  & InjectFace<CraftSectionInjected>

/** Section lifecycle: the roster read, not an individual row action. */
type SectionStatus = 'loading' | 'error' | 'ready'

/** The row action currently in flight. */
interface BusyAction {
  readonly id: string
  readonly kind: 'check' | 'launch'
}

/** State label keys, one per measured state. */
const STATE_KEY: Record<CraftUiState, CraftKey> = {
  'not-installed': 'state.not-installed',
  'app-installed-cli-missing': 'state.app-installed-cli-missing',
  'unsupported-version': 'state.unsupported-version',
  ready: 'state.ready',
  running: 'state.running',
  drifted: 'state.drifted',
  failed: 'state.failed',
  unavailable: 'state.unavailable',
}

/** Shared state-dot vocabulary: amber for a missing install, red for an install that cannot be trusted yet. */
function dotState(state: CraftUiState): 'warning' | 'error' | 'done' | 'ongoing' {
  switch (state) {
    case 'not-installed': return 'warning'
    case 'app-installed-cli-missing': return 'error'
    case 'unsupported-version': return 'error'
    case 'ready': return 'done'
    case 'running': return 'ongoing'
    case 'drifted': return 'error'
    case 'failed': return 'error'
    default: return 'warning'
  }
}

/**
 * Render the Craft section content column.
 * @param props - standard seat, locale copy, and the injected app source.
 * @returns the section element tree.
 */
export function CraftSection({ source, t }: CraftSectionProps) {
  const [status, setStatus] = useState<SectionStatus>('loading')
  const [rows, setRows] = useState<readonly CraftAppView[]>([])
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setStatus('loading')
    source.available().then(
      (next) => {
        if (!live) return
        setRows(next)
        setStatus('ready')
      },
      () => { if (live) setStatus('error') },
    )
    return () => { live = false }
  }, [source, attempt])

  const run = (row: CraftAppView, kind: BusyAction['kind']): void => {
    setBusy({ id: row.id, kind })
    setFailure(null)
    const action = kind === 'check' ? source.check : source.launchConnected
    action(row.id).then(
      (next) => {
        setRows(current => current.map(entry => entry.id === next.id ? next : entry))
        setBusy(null)
      },
      () => {
        setFailure(row.id)
        setBusy(null)
      },
    )
  }

  return (
    <div className={css.section}>
      <p className={css.lead}>{t('section.lead')}</p>
      {status === 'loading' && (
        <p className={css.status} role="status">{t('section.loading')}</p>
      )}
      {status === 'error' && (
        <div className={css.failureRow}>
          <p role="alert">{t('section.error')}</p>
          <button type="button" className={css.action} onClick={() => { setAttempt(value => value + 1) }}>
            {t('section.retry')}
          </button>
        </div>
      )}
      {status === 'ready' && rows.length === 0 && (
        <p className={css.status} role="status">{t('section.empty')}</p>
      )}
      {status === 'ready' && rows.length > 0 && rows.every(row => row.state === 'unavailable') && (
        <p className={css.status} role="status">{t('section.unavailable')}</p>
      )}
      {status === 'ready' && rows.length > 0 && (
        <ul className={css.rows}>
          {rows.map((row) => {
            const unavailable = row.state === 'unavailable'
            const working = busy !== null && busy.id === row.id ? busy.kind : null
            return (
              <li key={row.id} className={css.row} data-state={row.state}>
                <div className={css.head}>
                  <StateDot state={dotState(row.state)} />
                  <span className={css.name}>{row.displayName}</span>
                  <span className={css.badge}>{t(STATE_KEY[row.state])}</span>
                </div>
                {row.detail === undefined ? null : <p className={css.detail}>{row.detail}</p>}
                <div className={css.actions}>
                  <button
                    type="button"
                    className={css.action}
                    disabled={unavailable || busy !== null}
                    onClick={() => { run(row, 'check') }}
                  >
                    {working === 'check' ? t('action.checking') : t('action.check')}
                  </button>
                  {row.state === 'ready' && (
                    <button
                      type="button"
                      className={css.action}
                      disabled={busy !== null}
                      onClick={() => { run(row, 'launch') }}
                    >
                      {working === 'launch' ? t('action.launching') : t('action.launch')}
                    </button>
                  )}
                  {row.state === 'running' && (
                    <a className={css.action} href={row.launcherUrl} target="_blank" rel="noreferrer">
                      {t('action.launcher')}
                    </a>
                  )}
                  {(row.state === 'not-installed' || row.state === 'app-installed-cli-missing' || row.state === 'unsupported-version') && (
                    <a className={css.action} href={row.downloadUrl} target="_blank" rel="noreferrer">
                      {t('action.download')}
                    </a>
                  )}
                </div>
                {failure === row.id && (
                  <p className={css.failure} role="alert">{t('action.failed')}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

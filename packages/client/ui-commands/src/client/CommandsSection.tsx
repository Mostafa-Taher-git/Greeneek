/**
 * Commands settings section: a read-only roster of the slash commands the
 * current session's agent resolves — the same catalog the composer's `/`
 * menu serves. Rows never execute: the page is a directory, not a launcher.
 * No active session, a failed pull, and an empty catalog each render their
 * own explicit state instead of an empty list.
 */
import { useEffect, useState } from 'react'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
// Type-only: pulls the settings.section SlotMap merge (this section's seat)
// into the program — no runtime edge to ui-settings.
import type {} from '@greeneek/gnk-client-ui-settings/client'
// Type-only: pulls the useSessions global-seat merge into the program.
import type {} from '@greeneek/gnk-client-ui-session/client'
import type { CommandDescriptor } from './directory.ts'
import css from './CommandsSection.module.css'

/** Registration-side command source used by the section. */
export interface CommandsSectionInjected {
  /** Read the session's host command catalog (rejects when the pull fails). */
  listCommands: (sessionId: SessionId) => Promise<readonly CommandDescriptor[]>
}

/** Full component props assembled by the Settings slot renderer. */
export type CommandsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'command'>
  & InjectFace<CommandsSectionInjected>

type ViewState =
  | { readonly status: 'no-session' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly commands: readonly CommandDescriptor[] }

/**
 * Render the Commands section content column.
 * @param props - standard seat (useSessions), locale copy, and the injected command source.
 * @returns the section element tree.
 */
export function CommandsSection({ useSessions, t, listCommands }: CommandsSectionProps) {
  const sessionId = useSessions(s => s.current)
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    if (sessionId === undefined) {
      setView({ status: 'no-session' })
      return
    }
    let live = true
    setView({ status: 'loading' })
    listCommands(sessionId).then(
      (commands) => { if (live) setView({ status: 'ready', commands }) },
      () => { if (live) setView({ status: 'error' }) },
    )
    return () => { live = false }
  }, [sessionId, listCommands, attempt])

  return (
    <div className={css.section}>
      <p className={css.lead}>{t('section.lead')}</p>
      {view.status === 'no-session' && (
        <p className={css.status} role="status">{t('section.noSession')}</p>
      )}
      {view.status === 'loading' && (
        <p className={css.status} role="status">{t('section.loading')}</p>
      )}
      {view.status === 'error' && (
        <div className={css.failure}>
          <p role="alert">{t('section.error')}</p>
          <button type="button" className={css.retry} onClick={() => { setAttempt(a => a + 1) }}>
            {t('section.retry')}
          </button>
        </div>
      )}
      {view.status === 'ready' && (view.commands.length === 0
        ? <p className={css.status} role="status">{t('section.empty')}</p>
        : (
          <ul className={css.rows}>
            {view.commands.map(command => (
              <li key={command.name} className={css.row}>
                <code className={css.name}>/{command.name}</code>
                {command.description === '' ? null : (
                  <span className={css.description}>{command.description}</span>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

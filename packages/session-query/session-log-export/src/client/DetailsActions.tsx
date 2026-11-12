/**
 * Thread Details actions for one Session: the transcript copy and the log
 * download, with the shared download dialog.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@greeneek/gnk-client-store'
import type { SessionId } from '@greeneek/gnk-session/types'
import { Button } from '@greeneek/gnk-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { SessionLogDownloadDialog } from './Dialog.tsx'
import type { SessionMarkdownCopyState } from './markdown-controller.ts'
import { NS } from './locales.ts'
import css from './DetailsActions.module.css'

/** Browser operations and state injected into the Thread Details actions. */
export interface SessionExportActionsInjected {
  hooks: {
    sessionLogDownload: ObservableSnapshot<SessionLogDownloadState>
    sessionMarkdownCopy: ObservableSnapshot<SessionMarkdownCopyState>
  }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
  copyMarkdown: (sessionId: SessionId, title: string) => Promise<void>
  clearCopy: (sessionId: SessionId) => void
}

export type SessionExportActionsProps =
  PropsRuntime<'conversation.details.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionExportActionsInjected>

/**
 * Render one Session's export actions inside Thread Details.
 * @param props - Session identity, export controllers, and localized copy.
 * @returns the copy and download buttons with the shared download dialog.
 */
export function SessionExportActions({
  sessionId,
  useSessions,
  useSessionLogDownload,
  useSessionMarkdownCopy,
  request,
  dismiss,
  copyMarkdown,
  clearCopy,
  t,
}: SessionExportActionsProps): ReactNode {
  const title = useSessions(list => list.byId[sessionId]?.title ?? '')
  const copy = useSessionMarkdownCopy(state => state.bySession[String(sessionId)])
  const copied = copy?.status === 'copied'
  const error = copy?.status === 'error' ? copy.error : null
  // The copied label is a state, not a message: it clears itself so the button
  // returns to its idle wording without the user acting again.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { clearCopy(sessionId) }, 2_000)
    return () => { clearTimeout(timer) }
  }, [copied, clearCopy, sessionId])

  return (
    <div className={css.root}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('actions.copyMarkdown')}
        onClick={() => { void copyMarkdown(sessionId, title) }}
      >
        {copied ? t('actions.copied') : t('actions.copyShort')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('actions.downloadLog')}
        onClick={() => { void request(sessionId) }}
      >
        {t('actions.logShort')}
      </Button>
      {error !== null && (
        <span className={css.error} role="status">{error}</span>
      )}
      <SessionLogDownloadDialog
        sessionId={sessionId}
        useSessionLogDownload={useSessionLogDownload}
        dismiss={dismiss}
        t={t}
      />
    </div>
  )
}

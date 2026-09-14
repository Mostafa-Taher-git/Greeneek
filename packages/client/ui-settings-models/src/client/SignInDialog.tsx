/**
 * One sign-in attempt as a dialog: method picker, flow notices, prompt form,
 * and outcome. Frames arrive from `operations.attemptSignIn`; closing the
 * dialog aborts the stream, which withdraws the attempt on the Host — no
 * separate cancel call is needed on this path.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@greeneek/gnk-client-ui-primitives'
import type {
  AuthorizationAnswer, AuthorizationMethodView, AuthorizationNoticeView, AuthorizationPromptView,
} from '@greeneek/gnk-api-remotes/client'
import { providerCopy } from './ModelsSection.tsx'
import type { ProviderIdentity } from './ModelsSection.tsx'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import dialog from './SignInDialog.module.css'
import section from './ModelsSection.module.css'

/** Props of {@link SignInDialog}. */
export interface SignInDialogProps {
  /** The flow's wire key, as listed. */
  flowKey: string
  /** The flow's user-facing label. */
  flowLabel: string
  /** The methods the flow offers, most preferred first. */
  methods: readonly AuthorizationMethodView[]
  /** The Host operations this dialog drives. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Close the dialog; `authorized` reports whether the attempt settled authorized. */
  onClose: (authorized: boolean) => void
}

/** One open question with the id its answer must echo. */
interface OpenPrompt {
  readonly promptId: string
  readonly prompt: AuthorizationPromptView
}

/** Identity for the localized dialog title. */
function identityOf(flowKey: string, flowLabel: string): ProviderIdentity {
  return { provider: flowKey, displayName: flowLabel }
}

/**
 * Render the attempt dialog.
 * @param props - the flow, operations, copy, and close seat.
 * @returns the modal dialog.
 */
export function SignInDialog(props: SignInDialogProps): ReactNode {
  const { flowKey, flowLabel, methods, operations, t, onClose } = props
  const [method, setMethod] = useState<string | undefined>(undefined)
  const [notices, setNotices] = useState<readonly AuthorizationNoticeView[]>([])
  const [prompt, setPrompt] = useState<OpenPrompt | undefined>(undefined)
  const [input, setInput] = useState('')
  const [choice, setChoice] = useState<string | undefined>(undefined)
  const [settled, setSettled] = useState<'authorized' | 'cancelled' | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [answering, setAnswering] = useState(false)
  const [answerFailure, setAnswerFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (method === undefined) return
    const abort = new AbortController()
    const alive = { current: true }
    void (async () => {
      try {
        for await (const frame of operations.attemptSignIn(flowKey, method, abort.signal)) {
          switch (frame.kind) {
            case 'notice':
              setNotices(previous => [...previous, frame.notice])
              break
            case 'prompt':
              setPrompt({ promptId: frame.promptId, prompt: frame.prompt })
              setInput('')
              setChoice(undefined)
              break
            case 'prompt-withdrawn':
              setPrompt(current => current?.promptId === frame.promptId ? undefined : current)
              break
            case 'settled':
              setSettled(frame.status)
              break
          }
        }
      } catch (error) {
        if (alive.current) setFailure(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      alive.current = false
      abort.abort()
    }
  }, [flowKey, method, operations])

  const send = (promptId: string, answer: AuthorizationAnswer): void => {
    // A second dispatch while the first answer is in flight resends the same
    // prompt id, which the Host has already withdrawn: drop it here instead.
    // (jsdom never dispatches handlers on disabled controls, so no UI test
    // can take this return; the double-submit spec pins the single answer
    // through the disabled Submit button instead.)
    /* v8 ignore next -- jsdom never dispatches handlers on disabled controls */
    if (answering) return
    setAnswering(true)
    setAnswerFailure(undefined)
    void operations.answerSignInPrompt(flowKey, promptId, answer).then((refused) => {
      setAnswering(false)
      if (refused !== undefined) {
        setAnswerFailure(refused)
        return
      }
      setPrompt(current => current?.promptId === promptId ? undefined : current)
      setInput('')
    })
  }

  return (
    <Modal
      open
      onClose={() => { onClose(settled === 'authorized') }}
      title={providerCopy(t('signInTitle'), identityOf(flowKey, flowLabel))}
      closeLabel={t('close')}
      footer={(
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { onClose(settled === 'authorized') }}
        >
          {settled === undefined ? t('cancel') : t('close')}
        </Button>
      )}
    >
      {method === undefined ? (
        <div className={dialog.methods} role="group" aria-label={t('signInChooseMethod')}>
          {methods.map(entry => (
            <Button
              key={entry.id}
              variant="outline"
              size="sm"
              className={dialog.methodButton}
              onClick={() => { setMethod(entry.id) }}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      ) : (
        <>
          {notices.length === 0 && prompt === undefined && settled === undefined && failure === undefined
            ? <p className={dialog.status}>{t('signInWorking')}</p>
            : null}
          {notices.length > 0 ? (
            <ul className={dialog.notices}>
              {notices.map((notice, index) => (
                <li key={index} className={dialog.notice}>
                  <span>{notice.message}</span>
                  {notice.url === undefined ? null : (
                    <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a>
                  )}
                  {notice.code === undefined ? null : <span className={dialog.noticeCode}>{notice.code}</span>}
                </li>
              ))}
            </ul>
          ) : null}
          {prompt === undefined ? null : (
            <div className={dialog.promptForm}>
              <span className={section.fieldLabel}>{prompt.prompt.message}</span>
              {prompt.prompt.kind === 'select' ? (
                <select
                  className={`${section.input} ${section.selectInput}`}
                  aria-label={prompt.prompt.message}
                  value={choice ?? prompt.prompt.options[0]?.id ?? ''}
                  disabled={answering}
                  onChange={(event) => { setChoice(event.target.value) }}
                >
                  {prompt.prompt.options.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={section.input}
                  type={prompt.prompt.kind === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  aria-label={prompt.prompt.message}
                  placeholder={prompt.prompt.placeholder ?? ''}
                  value={input}
                  disabled={answering}
                  autoFocus
                  onChange={(event) => { setInput(event.target.value) }}
                />
              )}
              {answerFailure === undefined ? null : <p className={section.error}>{answerFailure}</p>}
              <div className={dialog.promptActions}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={answering || (prompt.prompt.kind !== 'select' && input.trim().length === 0)}
                  onClick={() => {
                    send(prompt.promptId, prompt.prompt.kind === 'select'
                      ? { status: 'answered', value: choice ?? prompt.prompt.options[0]?.id ?? '' }
                      : { status: 'answered', value: input })
                  }}
                >
                  {t('signInAnswer')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={answering}
                  onClick={() => { send(prompt.promptId, { status: 'declined' }) }}
                >
                  {t('signInDecline')}
                </Button>
              </div>
            </div>
          )}
          {settled === undefined ? null : (
            <p className={dialog.status} role="status">
              {settled === 'authorized' ? t('signInAuthorized') : t('signInCancelled')}
            </p>
          )}
          {failure === undefined ? null : <p className={section.error}>{failure}</p>}
        </>
      )}
    </Modal>
  )
}

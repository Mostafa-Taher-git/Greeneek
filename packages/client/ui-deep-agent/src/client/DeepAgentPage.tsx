/** Deep-agent standalone management page backed by real Host state. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type {} from '@greeneek/gnk-client-ui-layout/client'
import { IconWolf16 } from '@greeneek/gnk-client-ui-primitives'
import css from './DeepAgentPage.module.css'
import type { DeepAgentLocaleKey } from './locales.ts'

export interface StateView {
  readonly configured: boolean
  readonly paused: boolean
  readonly policyVersion: string
  readonly mode: string
  readonly counts: Readonly<Record<string, number>>
}

export interface TicketView {
  readonly id: string
  readonly title: string
  readonly stage: string
  readonly status: 'open' | 'ended'
  readonly outcome?: string
  readonly strength: string
  readonly actor: string
  readonly createdAt: string
  readonly undelivered: number
  readonly attention?: string
}

export interface DecisionView {
  readonly id: string
  readonly kind: string
  readonly at: string
  readonly threadKey: string
  readonly reasons: readonly string[]
  readonly ticketId?: string
}

export interface TriggerView {
  readonly id: string
  readonly source: string
  readonly actor: string
  readonly human: boolean
  readonly at: string
  readonly text: string
  readonly threads: readonly string[]
  readonly fanout: readonly string[]
}

export interface DeepAgentInjected {
  state: () => Promise<StateView>
  tickets: () => Promise<readonly TicketView[]>
  decisions: () => Promise<readonly DecisionView[]>
  triggers: () => Promise<readonly TriggerView[]>
  stop: (ticketId: string) => Promise<void>
  retry: (ticketId: string) => Promise<void>
  databasePath: () => Promise<string>
  maxWorkers: () => Promise<number>
  close: () => void
}

export type DeepAgentPageProps =
  PropsRuntime<'deep-agent'>
  & PropsLocale<'deepAgent'>
  & InjectFace<DeepAgentInjected>

type Tab = 'overview' | 'tickets' | 'decisions' | 'triggers'

/** Render the Deep-agent management page. */
export function DeepAgentPage(props: DeepAgentPageProps) {
  const {
    t, close, state: readState, tickets: readTickets, decisions: readDecisions,
    triggers: readTriggers, stop, retry, databasePath: readDatabasePath,
    maxWorkers: readMaxWorkers,
  } = props
  const [tab, setTab] = useState<Tab>('overview')
  const [state, setState] = useState<StateView>()
  const [tickets, setTickets] = useState<readonly TicketView[]>([])
  const [decisions, setDecisions] = useState<readonly DecisionView[]>([])
  const [triggers, setTriggers] = useState<readonly TriggerView[]>([])
  const [details, setDetails] = useState<{ databasePath: string; maxWorkers: number }>()
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      setError(undefined)
      const [s, tk, d, tg, path, workers] = await Promise.all([
        readState(), readTickets(), readDecisions(), readTriggers(), readDatabasePath(), readMaxWorkers(),
      ])
      setState(s)
      setTickets(tk)
      setDecisions(d)
      setTriggers(tg)
      setDetails({ databasePath: path, maxWorkers: workers })
    } catch {
      setError(t('loadFailed'))
    }
  }, [readState, readTickets, readDecisions, readTriggers, readDatabasePath, readMaxWorkers, t])

  useEffect(() => { void refresh() }, [refresh])

  const act = async (fn: () => Promise<void>): Promise<void> => {
    await fn()
    await refresh()
  }

  const metric = (label: DeepAgentLocaleKey, value: number | undefined): ReactNode => (
    <div className={css.metric}>
      <span className={css.metricValue}>{value ?? 0}</span>
      <span className={css.metricLabel}>{t(label)}</span>
    </div>
  )

  return (
    <div className={css.root}>
      <header className={css.header}>
        <div className={css.heading}>
          <IconWolf16 size={18} />
          <h2 className={css.title}>{t('title')}</h2>
        </div>
        <div className={css.actions}>
          <button type="button" onClick={() => { void refresh() }}>{t('refresh')}</button>
          <button type="button" aria-label={t('close')} onClick={close}>✕</button>
        </div>
      </header>
      <p className={css.intro}>{t('intro')}</p>
      {error !== undefined && <p className={css.error} role="alert">{error} <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></p>}

      <div className={css.tabs} role="tablist">
        {(['overview', 'tickets', 'decisions', 'triggers'] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? css.tabActive : css.tab}
            onClick={() => { setTab(id) }}
          >
            {t(id)}
          </button>
        ))}
      </div>

      {tab === 'overview' && state !== undefined && (
        <div className={css.section}>
          <p className={css.status}>
            {state.configured ? t('configured') : t('notConfigured')}
            {state.paused ? ` · ${t('paused')}` : ''}
            {' · '}{t('mode')}: {state.mode}
            {' · '}{t('policyVersion')}: {state.policyVersion}
          </p>
          <div className={css.metrics}>
            {metric('triggersCount', state.counts.triggers)}
            {metric('threadsCount', state.counts.threads)}
            {metric('ticketsCount', state.counts.tickets)}
            {metric('openTicketsCount', state.counts.openTickets)}
            {metric('decisionsCount', state.counts.decisions)}
            {metric('pendingEffectsCount', state.counts.pendingEffects)}
          </div>
          {details !== undefined && (
            <p className={css.detail}>{t('maxWorkers')}: {details.maxWorkers} · {t('databasePath')}: <code>{details.databasePath}</code></p>
          )}
        </div>
      )}

      {tab === 'tickets' && (
        <div className={css.section}>
          {tickets.length === 0
            ? <p className={css.empty}>{t('emptyTickets')}</p>
            : tickets.map(ticket => (
              <div key={ticket.id} className={css.row}>
                <div className={css.rowBody}>
                  <strong>{ticket.title}</strong>
                  <span className={css.meta}>{ticket.stage} · {ticket.strength} · {ticket.actor}{ticket.attention !== undefined ? ` · ${ticket.attention}` : ''}</span>
                </div>
                {ticket.status === 'open' && (
                  <div className={css.rowActions}>
                    <button type="button" onClick={() => { void act(() => retry(ticket.id)) }}>{t('retryTicket')}</button>
                    <button type="button" onClick={() => { void act(() => stop(ticket.id)) }}>{t('stop')}</button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {tab === 'decisions' && (
        <div className={css.section}>
          {decisions.length === 0
            ? <p className={css.empty}>{t('emptyDecisions')}</p>
            : decisions.map(decision => (
              <div key={decision.id} className={css.row}>
                <div className={css.rowBody}>
                  <strong>{decision.kind}</strong>
                  <span className={css.meta}>{decision.threadKey} · {decision.reasons.join(', ')}</span>
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === 'triggers' && (
        <div className={css.section}>
          {triggers.length === 0
            ? <p className={css.empty}>{t('emptyTriggers')}</p>
            : triggers.map(trigger => (
              <div key={trigger.id} className={css.row}>
                <div className={css.rowBody}>
                  <strong>{trigger.text}</strong>
                  <span className={css.meta}>{trigger.source} · {trigger.actor} · {trigger.threads.join(', ')}</span>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

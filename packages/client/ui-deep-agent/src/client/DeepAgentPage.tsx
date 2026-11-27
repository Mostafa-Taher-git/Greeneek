/** Deep-agent standalone management page backed by real Host state. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type {} from '@greeneek/gnk-client-ui-layout/client'
import type { PromptVersionView, SettingsSaveValue, SettingsView } from '@greeneek/gnk-deep-agent-runtime/types'
import { IconWolf16, TabBar } from '@greeneek/gnk-client-ui-primitives'
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
  decide: (request: { readonly triggerId: string; readonly accept: boolean; readonly reason: string }) => Promise<void>
  databasePath: () => Promise<string>
  maxWorkers: () => Promise<number>
  settings: () => Promise<SettingsView>
  saveSettings: (block: 'policy' | 'eval' | 'executor' | 'sources' | 'pause', value: SettingsSaveValue, revision: number) => Promise<SettingsView>
  prompts: () => Promise<readonly PromptVersionView[]>
  promptHistory: (name: string) => Promise<readonly PromptVersionView[]>
  savePrompt: (name: string, text: string) => Promise<PromptVersionView>
  resetPrompt: (request: { readonly name: string }) => Promise<PromptVersionView>
  close: () => void
}

export type DeepAgentPageProps =
  PropsRuntime<'deep-agent'>
  & PropsLocale<'deepAgent'>
  & InjectFace<DeepAgentInjected>

type Tab = 'overview' | 'tickets' | 'decisions' | 'triggers' | 'settings'

/** Render the Deep-agent management page. */
export function DeepAgentPage(props: DeepAgentPageProps) {
  const {
    t, close, state: readState, tickets: readTickets, decisions: readDecisions,
    triggers: readTriggers, stop, retry, decide: submitDecision, databasePath: readDatabasePath,
    maxWorkers: readMaxWorkers,
    settings: readSettings, saveSettings, prompts: readPrompts,
    promptHistory: readPromptHistoryRemote, savePrompt, resetPrompt,
  } = props
  const [tab, setTab] = useState<Tab>('overview')
  const [state, setState] = useState<StateView>()
  const [tickets, setTickets] = useState<readonly TicketView[]>([])
  const [decisions, setDecisions] = useState<readonly DecisionView[]>([])
  const [triggers, setTriggers] = useState<readonly TriggerView[]>([])
  const [details, setDetails] = useState<{ databasePath: string; maxWorkers: number }>()
  const [error, setError] = useState<string>()
  const [settings, setSettings] = useState<SettingsView>()
  const [promptList, setPromptList] = useState<readonly PromptVersionView[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string>()
  const [promptText, setPromptText] = useState('')
  const [promptVersions, setPromptVersions] = useState<readonly PromptVersionView[]>([])
  const [saveState, setSaveState] = useState<string>()
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({})

  const refreshSettings = useCallback(async () => {
    const [document, prompts] = await Promise.all([readSettings(), readPrompts()])
    setSettings(document)
    setPromptList(prompts)
    const first = prompts[0]
    if (selectedPrompt === undefined && first !== undefined) {
      setSelectedPrompt(first.name)
      setPromptText(first.text)
    }
  }, [readSettings, readPrompts, selectedPrompt])

  useEffect(() => { void refreshSettings().catch(() => { /* overview refresh reports errors */ }) }, [refreshSettings])

  const readPromptHistory = async (name: string): Promise<void> => {
    try {
      setPromptVersions(await readPromptHistoryRemote(name))
      setSaveState(undefined)
    } catch {
      setPromptVersions([])
      setSaveState(t('historyFailed'))
    }
  }

  const resetSelectedPrompt = async (): Promise<void> => {
    if (selectedPrompt === undefined) return
    try {
      const restored = await resetPrompt({ name: selectedPrompt })
      setPromptText(restored.text)
      await readPromptHistory(selectedPrompt)
      if (saveState !== t('historyFailed')) setSaveState(t('saved'))
    } catch {
      setSaveState(t('saveFailed'))
    }
  }

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

      <TabBar
        tabs={(['overview', 'tickets', 'decisions', 'triggers', 'settings'] as const).map(id => ({ id, label: t(id) }))}
        activeId={tab}
        onSelect={setTab}
      />

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
                <div className={css.rowActions}>
                  <input
                    aria-label={t('decisionReason')}
                    value={decisionReasons[trigger.id] ?? ''}
                    onChange={(event) => { setDecisionReasons(previous => ({ ...previous, [trigger.id]: event.target.value })) }}
                    placeholder={t('decisionReason')}
                  />
                  <button type="button" onClick={() => {
                    void act(() => submitDecision({
                      triggerId: trigger.id,
                      accept: true,
                      reason: decisionReasons[trigger.id] ?? '',
                    })).then(() => { setSaveState(t('decisionSaved')) })
                  }}>{t('accept')}</button>
                  <button type="button" onClick={() => {
                    void act(() => submitDecision({
                      triggerId: trigger.id,
                      accept: false,
                      reason: decisionReasons[trigger.id] ?? '',
                    })).then(() => { setSaveState(t('decisionSaved')) })
                  }}>{t('reject')}</button>
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === 'settings' && settings !== undefined && (
        <div className={css.section}>
          {saveState !== undefined && <p className={css.status}>{saveState}</p>}
          <div className={css.formRow}>
            <label className={css.field}>
              <span>{t('mode')}</span>
              <select
                value={settings.mode}
                onChange={(event) => { setSettings({ ...settings, mode: event.target.value as SettingsView['mode'] }) }}
              >
                <option value="off">{t('modeOff')}</option>
                <option value="observe">{t('modeObserve')}</option>
                <option value="auto">{t('modeAuto')}</option>
              </select>
            </label>
            <label className={css.field}>
              <span>{t('evalTimeout')}</span>
              <input
                type="number"
                value={settings.evalTimeoutSeconds}
                onChange={(event) => { setSettings({ ...settings, evalTimeoutSeconds: Number(event.target.value) }) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('maxWorkers')}</span>
              <input
                type="number"
                value={settings.maxWorkers}
                onChange={(event) => { setSettings({ ...settings, maxWorkers: Number(event.target.value) }) }}
              />
            </label>
            <label className={css.check}>
              <input
                type="checkbox"
                checked={settings.paused}
                onChange={(event) => { setSettings({ ...settings, paused: event.target.checked }) }}
              />
              {t('paused')}
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              void saveSettings('eval', {
                evalTimeoutSeconds: settings.evalTimeoutSeconds, maxWorkers: settings.maxWorkers,
                paused: settings.paused,
              }, settings.revision).then((saved) => {
                setSettings(saved)
                setSaveState(t('saved'))
              }).catch(() => { setSaveState(t('saveFailed')) })
            }}
          >
            {t('save')}
          </button>

          <h3 className={css.subTitle}>{t('rules')}</h3>
          {settings.rules.map((rule, index) => (
            <div key={rule.id} className={css.formRow}>
              <label className={css.field}>
                <span>{t('ruleName')}</span>
                <input
                  value={rule.name}
                  onChange={(event) => {
                    const rules = [...settings.rules]
                    rules[index] = { ...rule, name: event.target.value }
                    setSettings({ ...settings, rules })
                  }}
                />
              </label>
              <label className={css.field}>
                <span>{t('ruleInstruction')}</span>
                <input
                  value={rule.instruction}
                  onChange={(event) => {
                    const rules = [...settings.rules]
                    rules[index] = { ...rule, instruction: event.target.value }
                    setSettings({ ...settings, rules })
                  }}
                />
              </label>
              <label className={css.check}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => {
                    const rules = [...settings.rules]
                    rules[index] = { ...rule, enabled: event.target.checked }
                    setSettings({ ...settings, rules })
                  }}
                />
                {t('enabled')}
              </label>
              <button
                type="button"
                onClick={() => { setSettings({ ...settings, rules: settings.rules.filter(item => item.id !== rule.id) }) }}
              >
                {t('removeRule')}
              </button>
            </div>
          ))}
          <div className={css.formRow}>
            <button
              type="button"
              onClick={() => {
                const id = `rule-${Date.now()}`
                setSettings({
                  ...settings,
                  rules: [...settings.rules, { id, name: '', enabled: true, instruction: '' }],
                })
              }}
            >
              {t('addRule')}
            </button>
            <button
              type="button"
              onClick={() => {
                void saveSettings('policy', { rules: settings.rules, mode: settings.mode }, settings.revision)
                  .then((saved) => { setSettings(saved); setSaveState(t('saved')) })
                  .catch(() => { setSaveState(t('saveFailed')) })
              }}
            >
              {t('save')}
            </button>
          </div>

          <h3 className={css.subTitle}>{t('prompts')}</h3>
          <div className={css.formRow}>
            <select
              value={selectedPrompt ?? ''}
              onChange={(event) => {
                const name = event.target.value
                const prompt = promptList.find(item => item.name === name)
                setSelectedPrompt(name)
                setPromptText(prompt?.text ?? '')
                void readPromptHistory(name)
              }}
            >
              {promptList.map(prompt => (
                <option key={prompt.name} value={prompt.name}>{prompt.name}</option>
              ))}
            </select>
            <button type="button" onClick={() => { void readPromptHistory(selectedPrompt ?? '') }}>
              {t('promptHistory')}
            </button>
            <button type="button" onClick={() => { void resetSelectedPrompt() }}>{t('resetBuiltIn')}</button>
          </div>
          <textarea className={css.promptText} value={promptText} rows={8} onChange={(event) => { setPromptText(event.target.value) }} />
          <button
            type="button"
            onClick={() => {
              if (selectedPrompt === undefined) return
              void savePrompt(selectedPrompt, promptText)
                .then(() => { setSaveState(t('saved')); void refreshSettings() })
                .catch(() => { setSaveState(t('saveFailed')) })
            }}
          >
            {t('save')}
          </button>
          {promptVersions.map(version => (
            <div key={version.revision} className={css.row}>
              <span className={css.meta}>{t('version')} {version.version} · {version.builtIn ? t('builtIn') : t('custom')} · {version.createdAt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

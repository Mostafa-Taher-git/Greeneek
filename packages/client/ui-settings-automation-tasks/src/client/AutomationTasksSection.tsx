/**
 * Automation tasks settings section: status tabs, search, a New split button
 * with "Create in a session" / "Create manually", per-tab empty states, a
 * manual-create form, and task rows with pause/resume/run/delete.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import { SettingsSectionHeader, TabBar } from '@greeneek/gnk-client-ui-primitives'
import type { AutomationTasksLocaleKey } from './locales.ts'
import css from './AutomationTasksSection.module.css'

/** One task as the UI sees it. */
export interface AutomationTaskView {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly status: 'active' | 'paused' | 'ended'
  readonly repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  readonly at: string | null
  readonly timeZone: string
  readonly lastRunAt: string | null
  readonly history: readonly {
    readonly id: string
    readonly status: 'running' | 'succeeded' | 'failed'
    readonly startedAt: string
    readonly result: string | null
    readonly error: string | null
  }[]
  readonly updatedAt: string
}

/** Manual-create draft. */
export interface AutomationTaskDraft {
  title: string
  prompt: string
  repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  date: string
  time: string
  timeZone: string
}

/** Registration-side Remote face. */
export interface AutomationTasksInjected {
  list: () => Promise<readonly AutomationTaskView[]>
  create: (request: {
    title: string
    prompt: string
    cwd: string | null
    repeat: 'once' | 'hourly' | 'daily' | 'weekly'
    at: string | null
    timeZone: string | null
  }) => Promise<void>
  edit: (id: string, status: 'active' | 'paused' | 'ended', expectedUpdatedAt: string) => Promise<void>
  run: (id: string) => Promise<void>
  delete: (id: string) => Promise<void>
  /** Open a new session seeded with the "create an automation task" prompt. */
  createInSession: () => void
  /** Return to the conversation. */
  close: () => void
}

export type AutomationTasksSectionProps =
  PropsRuntime<'automation-tasks'>
  & PropsLocale<'settings.automationTasks'>
  & InjectFace<AutomationTasksInjected>

type Tab = 'active' | 'paused' | 'ended' | 'all'

/** Build a draft with its first occurrence one hour ahead in the local zone. */
function newDraft(): AutomationTaskDraft {
  const next = new Date(Date.now() + 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    title: '', prompt: '', repeat: 'once',
    date: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`,
    time: `${pad(next.getHours())}:${pad(next.getMinutes())}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/** Resolve the entered wall clock in its selected IANA time zone. */
function draftAt(draft: AutomationTaskDraft): string | null {
  const dateParts = draft.date.split('-').map(Number)
  const timeParts = draft.time.split(':').map(Number)
  const year = dateParts[0]
  const month = dateParts[1]
  const day = dateParts[2]
  const hour = timeParts[0]
  const minute = timeParts[1]
  if ([year, month, day, hour, minute].some(value => value === undefined || !Number.isFinite(value))) return null
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: draft.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const parts = (value: number) => {
    const fields = new Map(formatter.formatToParts(value).map(part => [part.type, part.value]))
    return {
      year: Number(fields.get('year')), month: Number(fields.get('month')), day: Number(fields.get('day')),
      hour: Number(fields.get('hour')), minute: Number(fields.get('minute')),
    }
  }
  const local = parts(target)
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - target
  const candidate = target - offset
  const matches = (value: number) => {
    const actual = parts(value)
    return actual.year === year && actual.month === month && actual.day === day
      && actual.hour === hour && actual.minute === minute
  }
  if (matches(candidate)) return new Date(candidate).toISOString()
  for (let delta = -180; delta <= 180; delta++) {
    const alternate = candidate + delta * 60_000
    if (matches(alternate)) return new Date(alternate).toISOString()
  }
  return null
}

/** Render the Automation tasks section. */
export function AutomationTasksSection(props: AutomationTasksSectionProps) {
  const { t, list, create, edit, run, delete: remove, createInSession, close } = props
  const [tasks, setTasks] = useState<readonly AutomationTaskView[]>([])
  const [tab, setTab] = useState<Tab>('active')
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<AutomationTaskDraft>(newDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      setError(undefined)
      setTasks(await list())
    } catch {
      setError(t('loadFailed'))
    }
  }, [list, t])

  useEffect(() => { void refresh() }, [refresh])

  const visible = useMemo(() => tasks.filter((task) => {
    const statusMatch = tab === 'all' || task.status === tab
    const textMatch = query.trim().length === 0
      || `${task.title} ${task.prompt}`.toLowerCase().includes(query.trim().toLowerCase())
    return statusMatch && textMatch
  }), [tasks, tab, query])

  const emptyKey = tab === 'active' ? 'emptyEnabled'
    : tab === 'paused' ? 'emptyPaused'
      : tab === 'ended' ? 'emptyEnded' : 'emptyAll'

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (draft.title.trim().length === 0 || draft.prompt.trim().length === 0 || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await create({
        title: draft.title.trim(), prompt: draft.prompt.trim(), cwd: null,
        repeat: draft.repeat, at: draftAt(draft),
        timeZone: draft.timeZone,
      })
      setFormOpen(false)
      setDraft(newDraft())
      await refresh()
    } catch {
      setError(t('invalidTime'))
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try { await fn(); await refresh() } finally { setBusy(false) }
  }

  return (
    <div className={css.root}>
      <SettingsSectionHeader
        title={t('title')}
        intro={t('intro')}
        closeLabel={t('close')}
        onClose={close}
        actionsClassName={css.headerActions}
      >
        <div className={css.newWrap}>
          <button
            type="button"
            className={css.newMain}
            disabled={busy}
            onClick={() => { setDraft(newDraft()); setFormOpen(true) }}
          >
            + {t('new')}
          </button>
          <button type="button" className={css.newCaret} aria-label={t('new')} onClick={() => { setMenuOpen(value => !value) }}>▾</button>
          {menuOpen && (
            <div className={css.menu} role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); createInSession() }}>{t('createInSession')}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDraft(newDraft()); setFormOpen(true) }}>{t('createManually')}</button>
            </div>
          )}
        </div>
      </SettingsSectionHeader>
      <TabBar
        tabs={(['active', 'paused', 'ended', 'all'] as const).map(id => ({
          id,
          label: t(id === 'all' ? 'tabAll' : id === 'active' ? 'tabEnabled' : id === 'paused' ? 'tabPaused' : 'tabEnded'),
        }))}
        activeId={tab}
        onSelect={setTab}
      />
      <input
        className={css.search}
        value={query}
        aria-label={t('search')}
        placeholder={t('search')}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {error !== undefined && <p className={css.error} role="alert">{error} <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></p>}

      {formOpen && (
        <form className={css.form} onSubmit={(event) => { void submit(event) }}>
          <div className={css.formTitle}>{t('createManually')}</div>
          <label className={css.field}>
            <span>{t('name')}</span>
            <input value={draft.title} placeholder={t('namePlaceholder')} onChange={(e) => { setDraft({ ...draft, title: e.target.value }) }} />
          </label>
          <label className={css.field}>
            <span>{t('instruction')}</span>
            <textarea value={draft.prompt} placeholder={t('instructionPlaceholder')} rows={4} onChange={(e) => { setDraft({ ...draft, prompt: e.target.value }) }} />
          </label>
          <div className={css.field}>
            <span>{t('runIn')}</span>
            <div className={css.readOnly}>{t('runInValue')}</div>
          </div>
          <div className={css.field}>
            <span>{t('linkedWorkspace')}</span>
            <div className={css.readOnly}>{t('defaultWorkspace')}</div>
          </div>
          <div className={css.field}>
            <span>{t('runTime')}</span>
            <div className={css.timing}>
              <label><span>{t('repeat')}</span>
                <select value={draft.repeat} onChange={(e) => { setDraft({ ...draft, repeat: e.target.value as AutomationTaskDraft['repeat'] }) }}>
                  <option value="once">{t('repeatOnce')}</option>
                  <option value="hourly">{t('repeatHourly')}</option>
                  <option value="daily">{t('repeatDaily')}</option>
                  <option value="weekly">{t('repeatWeekly')}</option>
                </select>
              </label>
              <label><span>{t('date')}</span><input type="date" value={draft.date} onChange={(e) => { setDraft({ ...draft, date: e.target.value }) }} /></label>
              <label><span>{t('time')}</span><input type="time" value={draft.time} onChange={(e) => { setDraft({ ...draft, time: e.target.value }) }} /></label>
              <label><span>{t('timeZone')}</span><input value={draft.timeZone} onChange={(e) => { setDraft({ ...draft, timeZone: e.target.value }) }} /></label>
            </div>
          </div>
          <div className={css.formActions}>
            <button type="button" onClick={() => { setFormOpen(false) }}>{t('discard')}</button>
            <button type="submit" disabled={busy || draft.title.trim().length === 0 || draft.prompt.trim().length === 0}>{t('create')}</button>
          </div>
        </form>
      )}

      {visible.length === 0 && !formOpen && (
        <div className={css.empty}>
          <div className={css.emptyIcon}>⏱</div>
          <p>{t(emptyKey)}</p>
          <button type="button" onClick={() => { setDraft(newDraft()); setFormOpen(true) }}>{t('newTask')}</button>
        </div>
      )}
      {visible.length > 0 && (
        <div className={css.list}>
          {visible.map(task => (
            <div key={task.id} className={css.row}>
              <div className={css.rowBody}>
                <strong>{task.title}</strong>
                <span className={css.rowMeta}>{t(`status${task.status.charAt(0).toUpperCase()}${task.status.slice(1)}` as AutomationTasksLocaleKey)} · {t(`repeat${task.repeat.charAt(0).toUpperCase()}${task.repeat.slice(1)}` as AutomationTasksLocaleKey)}{task.lastRunAt ? ` · ${task.lastRunAt}` : ''}</span>
                {task.history.length > 0 && (
                  <details className={css.history}>
                    <summary>{t('runHistory')} ({task.history.length})</summary>
                    {[...task.history].reverse().map(run => (
                      <div key={run.id} className={css.run}>
                        <strong>{t(`run${run.status.charAt(0).toUpperCase()}${run.status.slice(1)}` as AutomationTasksLocaleKey)}</strong>
                        <time dateTime={run.startedAt}>{run.startedAt}</time>
                        {run.result !== null && <p>{run.result}</p>}
                        {run.error !== null && <p role="alert">{run.error}</p>}
                      </div>
                    ))}
                  </details>
                )}
              </div>
              <div className={css.rowActions}>
                {task.status === 'active'
                  ? <button type="button" disabled={busy} onClick={() => { void act(() => edit(task.id, 'paused', task.updatedAt)) }}>{t('pause')}</button>
                  : <button type="button" disabled={busy} onClick={() => { void act(() => edit(task.id, 'active', task.updatedAt)) }}>{t('resume')}</button>}
                <button type="button" disabled={busy} onClick={() => { void act(() => run(task.id)) }}>{t('runNow')}</button>
                <button type="button" disabled={busy} onClick={() => { void act(() => remove(task.id)) }}>{t('remove')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

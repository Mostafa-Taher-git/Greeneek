import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { IconCloseOutline16 } from '@greeneek/gnk-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ToolCallBlock } from '../contract/snapshot.ts'
import css from './TerminalDrawer.module.css'

/** Live PTY verbs injected by the Chat plugin. */
export interface TerminalDrawerInjected {
  /** Open a Host PTY in the current workspace. */
  open: (path: string, cols: number, rows: number) => Promise<string>
  /** Write to a live PTY's stdin. */
  write: (id: string, data: string) => Promise<void>
  /** Resize a live PTY. */
  resize: (id: string, cols: number, rows: number) => Promise<void>
  /** Subscribe to a live PTY's frames. */
  events: (id: string, signal: AbortSignal) => AsyncIterable<
    | { type: 'data'; data: string }
    | { type: 'exit'; exitCode: number | null }
  >
  /** Terminate a live PTY. */
  closePty: (id: string) => Promise<void>
}

export type TerminalDrawerProps = PropsRuntime<'terminal.drawer'>
  & TerminalDrawerInjected
  & PropsLocale<'chat'>

interface TerminalActivity {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
  readonly output: string
  readonly state: 'running' | 'completed' | 'error'
  readonly time: number
}

const TERMINAL_TOOLS = new Set([
  'bash', 'pwsh', 'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal',
  'terminal_close', 'terminal_list', 'job_output', 'job_kill',
])

function activityOf(block: ToolCallBlock): TerminalActivity | undefined {
  const settled = 'kind' in block
  const name = settled ? block.call?.name : block.name
  if (name === undefined || !TERMINAL_TOOLS.has(name)) return undefined
  const output = settled
    ? block.content.map(item => item.type === 'text' ? item.text : `[${item.type}]`).join('\n')
    : ''
  return {
    callId: block.callId,
    name,
    argsRaw: settled ? block.call?.argsRaw ?? '' : block.argsRaw,
    output,
    state: settled ? block.isError ? 'error' : 'completed' : 'running',
    time: block.time,
  }
}

function activitiesFor(roots: readonly ToolCallBlock[]): TerminalActivity[] {
  const activities: TerminalActivity[] = []
  const visit = (block: ToolCallBlock): void => {
    const activity = activityOf(block)
    if (activity !== undefined) activities.push(activity)
    for (const child of block.subCalls) visit(child)
  }
  for (const root of roots) visit(root)
  activities.sort((a, b) => a.time - b.time)
  return activities
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** Render the loaded session's terminal-related tool activity in a bottom drawer. */
export function TerminalDrawer({
  useChat, useSessions, sessionId, open, write, close, closePty, events, resize, t,
}: TerminalDrawerProps) {
  const roots = useChat(snapshot => snapshot.nodes.values()
    .flatMap(node => node.kind === 'tool-call' ? [(node as ChatNode<'tool-call'>).data.root] : []))
  const activities = activitiesFor(roots)
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const [ptyId, setPtyId] = useState<string>()
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string>()
  const ptyRef = useRef<string>()

  useEffect(() => {
    if (cwd === undefined) return
    const controller = new AbortController()
    let live = true
    open(cwd, 100, 24)
      .then(async (id) => {
        if (!live) { await closePty(id); return }
        ptyRef.current = id
        setPtyId(id)
        void resize(id, 100, 24)
        for await (const frame of events(id, controller.signal)) {
          if (frame.type === 'data') setOutput(current => current + frame.data)
          else setOutput(current => `${current}\n[exit ${frame.exitCode}]`)
        }
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      live = false
      controller.abort()
      const id = ptyRef.current
      if (id !== undefined) void closePty(id)
    }
  }, [cwd, open, events, closePty, resize])

  const submit = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || ptyId === undefined) return
    event.preventDefault()
    void write(ptyId, `${input}\n`).then(() => { setInput('') })
  }

  return (
    <section className={css.root} aria-label={t('terminal.title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('terminal.title')}</h2>
        <button type="button" className={css.close} aria-label={t('details.close')} onClick={close}>
          <IconCloseOutline16 size={14} />
        </button>
      </header>
      <section className={css.pty} aria-label="Interactive terminal">
        {error !== undefined && <p className={css.error} role="alert">{error}</p>}
        <pre className={css.output}>{output}</pre>
        <input
          className={css.input}
          value={input}
          disabled={ptyId === undefined}
          aria-label="Terminal input"
          placeholder={ptyId === undefined ? 'No workspace' : 'Type a command and press Enter'}
          onChange={(event) => { setInput(event.target.value) }}
          onKeyDown={submit}
        />
      </section>
      <div className={css.list}>
        {activities.length === 0
          ? <p className={css.empty}>{t('terminal.empty')}</p>
          : activities.map(activity => (
            <article key={activity.callId} className={css.activity}>
              <div className={css.activityHeader}>
                <strong>{activity.name}</strong>
                <span data-state={activity.state}>
                  {t(`terminal.${activity.state}`)}
                </span>
              </div>
              {activity.argsRaw !== '' && (
                <section className={css.section}>
                  <h3>{t('terminal.input')}</h3>
                  <pre>{pretty(activity.argsRaw)}</pre>
                </section>
              )}
              {activity.output !== '' && (
                <section className={css.section}>
                  <h3>{t('terminal.output')}</h3>
                  <pre data-error={activity.state === 'error' || undefined}>{activity.output}</pre>
                </section>
              )}
            </article>
          ))}
      </div>
    </section>
  )
}

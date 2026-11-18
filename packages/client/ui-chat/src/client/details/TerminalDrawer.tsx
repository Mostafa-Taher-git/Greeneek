import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Terminal } from '@xterm/headless'
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

/** Initial and bounded grid used by the emulator and the Host PTY. */
const GRID_COLS = 100
const GRID_ROWS = 24
const SCROLLBACK = 1000

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

/** Render the emulator's visible screen as plain text, with no escape sequences. */
function screenText(emulator: Terminal): string {
  const buffer = emulator.buffer.active
  const lines: string[] = []
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    if (line !== undefined) lines.push(line.translateToString(true))
  }
  return lines.join('\n').replace(/\s+$/, '')
}

/**
 * Render the loaded session's terminal activity plus a live interactive PTY.
 * PTY bytes are interpreted by a headless xterm screen, so control sequences
 * are applied rather than printed; every key is forwarded to the Host shell.
 */
export function TerminalDrawer({
  useChat, useSessions, sessionId, open, write, close, closePty, events, resize, t,
}: TerminalDrawerProps) {
  const roots = useChat(snapshot => snapshot.nodes.values()
    .flatMap(node => node.kind === 'tool-call' ? [(node as ChatNode<'tool-call'>).data.root] : []))
  const activities = activitiesFor(roots)
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const [screen, setScreen] = useState('')
  const [ptyId, setPtyId] = useState<string>()
  const [error, setError] = useState<string>()
  const [generation, setGeneration] = useState(0)
  const ptyRef = useRef<string>()
  const emulatorRef = useRef<Terminal>()

  useEffect(() => {
    if (cwd === undefined) return
    const emulator = new Terminal({
      cols: GRID_COLS, rows: GRID_ROWS, scrollback: SCROLLBACK, allowProposedApi: true,
    })
    emulatorRef.current = emulator
    const controller = new AbortController()
    setScreen('')
    setError(undefined)

    open(cwd, GRID_COLS, GRID_ROWS)
      .then(async (id) => {
        if (controller.signal.aborted) { await closePty(id); return }
        ptyRef.current = id
        setPtyId(id)
        void resize(id, emulator.cols, emulator.rows)
        for await (const frame of events(id, controller.signal)) {
          if (frame.type === 'data') {
            emulator.write(frame.data)
            setScreen(screenText(emulator))
          } else {
            emulator.write(`\r\n[exit ${frame.exitCode ?? ''}]\r\n`)
            setScreen(screenText(emulator))
            ptyRef.current = undefined
            setPtyId(undefined)
          }
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })

    const observer = new ResizeObserver(() => {
      const id = ptyRef.current
      if (id === undefined) return
      const cols = Math.max(20, Math.min(400, emulator.cols))
      const rows = Math.max(5, Math.min(200, emulator.rows))
      emulator.resize(cols, rows)
      void resize(id, cols, rows)
    })
    observer.observe(document.body)

    return () => {
      controller.abort()
      observer.disconnect()
      const id = ptyRef.current
      ptyRef.current = undefined
      if (id !== undefined) void closePty(id)
      emulator.dispose()
      emulatorRef.current = undefined
    }
  }, [cwd, open, events, closePty, resize, generation])

  const onKeyDown = (event: KeyboardEvent<HTMLPreElement>): void => {
    const id = ptyRef.current
    if (id === undefined) return
    const key = event.key
    let data: string | undefined
    if (key === 'Enter') data = '\r'
    else if (key === 'Backspace') data = '\x7f'
    else if (key === 'Tab') data = '\t'
    else if (key === 'ArrowUp') data = '\x1b[A'
    else if (key === 'ArrowDown') data = '\x1b[B'
    else if (key === 'ArrowRight') data = '\x1b[C'
    else if (key === 'ArrowLeft') data = '\x1b[D'
    else if (key === 'Home') data = '\x1b[H'
    else if (key === 'End') data = '\x1b[F'
    else if (key === 'Delete') data = '\x1b[3~'
    else if (key === 'Escape') data = '\x1b'
    else if (event.ctrlKey && key.length === 1) data = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64)
    else if (key.length === 1 && !event.metaKey && !event.altKey) data = key
    if (data === undefined) return
    event.preventDefault()
    void write(id, data)
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
        <pre
          className={css.output}
          tabIndex={0}
          aria-label="Terminal screen"
          onKeyDown={onKeyDown}
        >{screen}</pre>
        <div className={css.actions}>
          <span className={css.hint}>{ptyId === undefined ? t('terminal.closed') : t('terminal.hint')}</span>
          {ptyId === undefined && cwd !== undefined && (
            <button type="button" className={css.reopen} onClick={() => { setGeneration(value => value + 1) }}>
              {t('terminal.reopen')}
            </button>
          )}
        </div>
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

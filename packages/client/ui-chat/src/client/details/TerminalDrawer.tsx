import { IconCloseOutline16 } from '@greeneek/gnk-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ToolCallBlock } from '../contract/snapshot.ts'
import css from './TerminalDrawer.module.css'

export type TerminalDrawerProps = PropsRuntime<'terminal.drawer'> & PropsLocale<'chat'>

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
export function TerminalDrawer({ useChat, close, t }: TerminalDrawerProps) {
  const roots = useChat(snapshot => snapshot.nodes.values()
    .flatMap(node => node.kind === 'tool-call' ? [(node as ChatNode<'tool-call'>).data.root] : []))
  const activities = activitiesFor(roots)
  return (
    <section className={css.root} aria-label={t('terminal.title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('terminal.title')}</h2>
        <button type="button" className={css.close} aria-label={t('details.close')} onClick={close}>
          <IconCloseOutline16 size={14} />
        </button>
      </header>
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

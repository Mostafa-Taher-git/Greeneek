import type { ReactNode } from 'react'
import type { FleetAgentItem } from './contract.ts'
import css from './PreviousAgents.module.css'

/**
 * Render the Harness agents that ran under this Session.
 * @param props - the agent rows and the localized copy.
 * @returns the agent rows, or the empty-state line when no agent ran.
 */
export function PreviousAgents({
  agents,
  title,
  empty,
  running,
}: {
  readonly agents: readonly FleetAgentItem[]
  readonly title: string
  readonly empty: string
  readonly running: string
}): ReactNode {
  return (
    <section className={css.root} aria-label={title}>
      <h3 className={css.title}>{title}</h3>
      {agents.length === 0
        ? <p className={css.empty}>{empty}</p>
        : (
          <ul className={css.rows}>
            {agents.map(agent => (
              <li key={agent.id} className={css.row} data-running={agent.running || undefined}>
                <span className={css.label} title={agent.displayTitle}>{agent.displayTitle}</span>
                {agent.running && <span className={css.state}>{running}</span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import type { FleetSidebarProps } from './contract.ts'
import { fleetAgents, fleetLineage } from './contract.ts'
import { IconBrainCircuit16, IconChevronDownOutline14, IconTreeCorner8x10 } from '@greeneek/gnk-client-ui-primitives'
import { FleetPanel } from './FleetPanel.tsx'
import css from './FleetSidebar.module.css'

/** Width of one indent step in the Lineage tree, in pixels. */
const INDENT_PX = 14

/**
 * Dedicated right-sidebar fleet surface (S5-11a): a T3-shaped hierarchy of
 * sections over the reused FleetPanel body. The Lineage section lists the
 * real Session chain; the agents that ran under this Session collapse into
 * one Previous agents group inside it; the Live Fleet section sits directly
 * underneath Lineage and shows the Harness agents currently running under
 * it. The Emergency Stop lives at the top of FleetPanel and stays reachable
 * while stoppable; the composer pill remains the narrow-width fallback.
 * There is no panel-internal close button: the session header carries the
 * one toggle, so the panel never offers a second way to do the same thing.
 * @param props - the live mirror, the fleet verbs, the session readers, and the fleet copy.
 * @returns the right-sidebar fleet panel.
 */
export function FleetSidebar(props: FleetSidebarProps) {
  const { t, useFleet, useSessions, sessionId, openSession, openChild, openSidebar } = props
  const snapshot = useFleet(view => view)
  const lineage = useSessions(state => fleetLineage(state, sessionId))
  const agents = useSessions(state => fleetAgents(state, sessionId))
  // Auto-open on the empty->running edge only, so tool clicks keep stronger
  // intent and a manual close sticks until a new fleet starts.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (snapshot.stoppable && !wasRunning.current) openSidebar()
    wasRunning.current = snapshot.stoppable
  }, [snapshot.stoppable, openSidebar])
  // Previous agents start collapsed (the T3 convention: new information stays
  // compact until asked for); the row carries the total count and expands on demand.
  const [agentsOpen, setAgentsOpen] = useState(false)
  const agentsListId = useId()
  const lineageHeadingId = useId()
  const fleetHeadingId = useId()
  return (
    <div className={css.root} data-fleet-sidebar>
      <section className={css.section} aria-labelledby={lineageHeadingId}>
        <h3 id={lineageHeadingId} className={css.heading}>{t('lineage.title')}</h3>
        <nav aria-label={t('lineage.aria')}>
          <ol className={css.lineageList}>
            {lineage.map((item, index) => (
              <li key={item.id} className={css.lineageItem} style={{ paddingInlineStart: `${index * INDENT_PX}px` }}>
                <button
                  type="button"
                  className={css.row}
                  aria-current={item.id === sessionId ? 'page' : undefined}
                  title={item.displayTitle}
                  onClick={() => { openSession(item.id) }}
                >
                  <IconTreeCorner8x10 className={css.rowIcon} aria-hidden="true" />
                  <span className={css.rowLabel} dir="auto">{item.displayTitle}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <button
          type="button"
          className={css.row}
          aria-expanded={agentsOpen}
          aria-controls={agentsListId}
          onClick={() => { setAgentsOpen(current => !current) }}
        >
          <IconBrainCircuit16 className={css.rowIcon} aria-hidden="true" />
          <span className={css.rowLabel}>{t('lineage.agents.title')}</span>
          {agentsOpen ? null : <span className={css.count}>{agents.length}</span>}
          <IconChevronDownOutline14 size={16} className={agentsOpen ? css.chevron : `${css.chevron} ${css.chevronCollapsed}`} aria-hidden="true" />
        </button>
        {agentsOpen && (
          <div id={agentsListId} className={css.agentsGroup} role="region" aria-label={t('lineage.agents.title')}>
            {agents.length === 0
              ? <p className={css.agentsEmpty}>{t('lineage.agents.empty')}</p>
              : (
                <ul className={css.agentList}>
                  {agents.map(agent => (
                    <li key={agent.id}>
                      <button
                        type="button"
                        className={css.agentRow}
                        title={agent.displayTitle}
                        onClick={() => { openChild(agent.id) }}
                      >
                        <IconBrainCircuit16 className={css.rowIcon} aria-hidden="true" />
                        <span className={css.rowLabel} dir="auto">{agent.displayTitle}</span>
                        {agent.running && <span className={css.running}>{t('lineage.agents.running')}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
      </section>
      {/* Live Fleet sits directly underneath Lineage, sharing the row language. */}
      <section className={css.section} aria-labelledby={fleetHeadingId}>
        <h3 id={fleetHeadingId} className={css.heading}>{t('fleet.title')}</h3>
        <FleetPanel {...props} />
      </section>
    </div>
  )
}

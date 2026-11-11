import { useEffect, useRef } from 'react'
import type { FleetSidebarProps } from './contract.ts'
import { FleetPanel } from './FleetPanel.tsx'
import css from './FleetSidebar.module.css'

/**
 * Dedicated right-sidebar fleet surface (S5-11a): a one-click open/close
 * chrome over the reused FleetPanel body, so the live agent/fleet work is
 * always visible while agents run and never a tab inside the details column.
 * The Emergency Stop lives at the top of FleetPanel and stays reachable
 * while stoppable; the composer pill remains the narrow-width fallback.
 * @param props - the live mirror, the fleet verbs, and the fleet copy.
 * @returns the right-sidebar fleet panel.
 */
export function FleetSidebar(props: FleetSidebarProps) {
  const { t, useFleet, openSidebar, closeSidebar } = props
  const snapshot = useFleet(view => view)
  // Auto-open on the empty->running edge only, so tool clicks keep stronger
  // intent and a manual close sticks until a new fleet starts.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (snapshot.stoppable && !wasRunning.current) openSidebar()
    wasRunning.current = snapshot.stoppable
  }, [snapshot.stoppable, openSidebar])
  return (
    <div className={css.root} data-fleet-sidebar>
      <div className={css.header}>
        <span className={css.title}>{t('sidebar.title')}</span>
        <button
          type="button"
          className={css.close}
          aria-label={t('sidebar.close.aria')}
          onClick={() => { closeSidebar() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}>
        <FleetPanel {...props} />
      </div>
    </div>
  )
}

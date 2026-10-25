import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { IconChevronDownOutline14, useDismissOnOutsidePointer } from '@greeneek/gnk-client-ui-primitives'
import type { WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { FleetPillProps } from './contract.ts'
import { FleetPanel } from './FleetPanel.tsx'
import { runningMembers } from './member-state.ts'
import css from './FleetPill.module.css'
import { useEmergencyStop } from './use-stop.ts'

/**
 * The wave the pill names: the newest one still running, else the newest
 * listed. Nothing is named while the session lists no wave at all.
 * @param views - the polled wave views.
 * @returns the wave to label, or undefined for an empty fleet.
 */
function namedWave(views: readonly WaveView[]): WaveView | undefined {
  return [...views].reverse().find(wave => !wave.closed) ?? views[0]
}

/**
 * Composer-left fleet pill: the Army affordance that survives a details column
 * too narrow to open. It reports the live fleet in one line, keeps the
 * emergency stop on the pill itself, and opens the full panel above the composer.
 * @param props - the live mirror, the fleet verbs, and the copy.
 * @returns the pill, its overlay, or nothing while the session has no fleet.
 */
export function FleetPill(props: FleetPillProps) {
  const { t, useFleet, refresh, stopAll } = props
  const snapshot = useFleet(view => view)
  const stop = useEmergencyStop(t, stopAll)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // Re-opening the overlay after the mirror settled on its idle cadence should
  // show the current fleet, not the last sampled one.
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // A fleet that empties removes the trigger; closing first keeps focus from
  // vanishing with the node that held it, and stops the overlay reappearing on
  // the next wave.
  const shown = namedWave(snapshot.waveViews)
  useEffect(() => {
    if (shown === undefined) setOpen(false)
  }, [shown])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  if (shown === undefined) return null

  const label = snapshot.degraded
    ? t('pill.label.degraded', { label: shown.label })
    : t('pill.label', { label: shown.label, running: runningMembers(snapshot.waveViews) })

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <div className={css.pill} data-degraded={snapshot.degraded || undefined}>
        <button
          ref={triggerRef}
          type="button"
          className={css.trigger}
          aria-expanded={open}
          aria-label={t('pill.open.aria')}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.label} title={label}>{label}</span>
          <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
        </button>
        {snapshot.stoppable && (
          <button
            type="button"
            className={css.stop}
            data-armed={stop.armed || undefined}
            aria-label={t(stop.armed ? 'stop.all.confirm' : 'pill.stop.aria')}
            onClick={stop.click}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <rect x="4" y="4" width="8" height="8" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
      {stop.notice !== null && <span className={css.notice} role="status">{stop.notice}</span>}
      {open && (
        <div className={css.overlay} role="dialog" aria-label={t('pill.open.aria')}>
          <button
            type="button"
            className={css.overlayClose}
            aria-label={t('pill.close.aria')}
            onClick={() => { setOpen(false) }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <FleetPanel {...props} />
        </div>
      )}
    </div>
  )
}

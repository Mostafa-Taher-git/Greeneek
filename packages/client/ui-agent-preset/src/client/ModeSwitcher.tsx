import { useId } from 'react'
import type { ReactNode } from 'react'
import css from './ModeSwitcher.module.css'

/** One selectable mode: a live roster preset or a parked placeholder. */
export interface ModeSwitcherEntry {
  /** Preset id staged on select; placeholders never select. */
  id: string
  /** Option label. */
  name: string
  /** One-line description of the mode the person is on. */
  description?: string
  /** Leading glyph for the staged mode. */
  icon: ReactNode
  /** Parked placeholders render disabled and never select. */
  disabled?: boolean
}

/**
 * Render the registered modes as one dropdown for the workspace row.
 *
 * A native `<select>` puts every mode on one control at any width: the pill row it
 * replaces scrolled horizontally on narrow screens and needed hover to reveal a
 * description, which left keyboard and pointer users on different paths. Arrow-key
 * navigation, type-ahead, and the platform popup come with the element, and the
 * accessible name stays the localized `label` while the staged mode's sentence is
 * linked through `aria-describedby` so an elided caption is still announced.
 *
 * The glyph is drawn beside the control because an `<option>` cannot carry one. The
 * caption and the select value both follow `current`, so a switch the host refuses
 * visibly returns to the mode that stayed staged. A staged id the roster no longer
 * offers — a retired preset a session still runs — gets a hidden disabled option of
 * its own rather than leaving the control to display the first mode it does offer.
 * @param props - group label, ordered entries, staged id, selection, and busy state.
 * @returns the dropdown row: glyph, select, and the staged mode's caption.
 */
export function ModeSwitcher({ label, entries, current, busy, onSelect }: {
  label: string
  entries: readonly ModeSwitcherEntry[]
  current: string
  busy: boolean
  onSelect: (id: string) => void
}): ReactNode {
  const descriptionId = useId()
  const shown = entries.find(entry => entry.id === current)
  const description = shown?.description

  return (
    <div className={css.root}>
      <span className={css.icon} aria-hidden="true">{shown?.icon}</span>
      <select
        className={css.select}
        aria-label={label}
        aria-describedby={description === undefined ? undefined : descriptionId}
        value={current}
        disabled={busy}
        onChange={(event) => { onSelect(event.target.value) }}
      >
        {shown === undefined ? <option value={current} disabled hidden>{current}</option> : null}
        {entries.map(entry => (
          <option key={entry.id} value={entry.id} disabled={entry.disabled === true}>
            {entry.name}
          </option>
        ))}
      </select>
      {description === undefined ? null : (
        <p id={descriptionId} className={css.description}>{description}</p>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { ReactNode } from 'react'
import css from './ModeSwitcher.module.css'

/** One mode pill: a live roster preset or a coming-soon placeholder. */
export interface ModeSwitcherEntry {
  /** Preset id staged on select; placeholders never select. */
  id: string
  /** Pill label and radiogroup name. */
  name: string
  /** One-line description shown under the row. */
  description?: string
  /** Leading glyph. */
  icon: ReactNode
  /** Coming-soon pills render dimmed and never select. */
  disabled?: boolean
  /** Tooltip explaining why the pill cannot be picked yet. */
  disabledReason?: string
}

/**
 * Render the horizontal hover-to-reveal mode switcher.
 *
 * Expansion is pure CSS (`:hover` + `:focus-within` on the row) so keyboard
 * users get the same reveal as pointer users with no focus bookkeeping. The
 * description previews the hovered/focused pill and settles on the active
 * mode's — placeholders can never be selected, so previewing is the only way
 * their copy ever shows before their presets land. Hover uses the bubbling
 * `mouseover` rather than `mouseenter` so the preview is unit-testable;
 * re-fires within a pill settle on the same id and render nothing new.
 * @param props - group label, ordered entries, staged id, selection, and busy state.
 * @returns the radiogroup row plus its description line.
 */
export function ModeSwitcher({ label, entries, current, busy, onSelect }: {
  label: string
  entries: readonly ModeSwitcherEntry[]
  current: string
  busy: boolean
  onSelect: (id: string) => void
}): ReactNode {
  const [previewed, setPreviewed] = useState<string | null>(null)
  const shown = entries.find(entry => entry.id === previewed) ?? entries.find(entry => entry.id === current)

  return (
    <div className={css.root}>
      <div
        role="radiogroup"
        aria-label={label}
        className={css.row}
        onMouseLeave={() => { setPreviewed(null) }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPreviewed(null)
        }}
      >
        {entries.map((entry) => {
          const active = entry.id === current
          const off = busy || entry.disabled === true
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={entry.name}
              disabled={off}
              title={entry.disabled === true ? entry.disabledReason : undefined}
              className={active ? `${css.pill} ${css.pillActive}` : css.pill}
              onMouseOver={() => { setPreviewed(entry.id) }}
              onFocus={() => { setPreviewed(entry.id) }}
              onClick={() => { onSelect(entry.id) }}
            >
              <span className={css.pillIcon} aria-hidden="true">{entry.icon}</span>
              <span className={css.pillLabel}>{entry.name}</span>
            </button>
          )
        })}
      </div>
      <p className={css.description}>{shown?.description}</p>
    </div>
  )
}

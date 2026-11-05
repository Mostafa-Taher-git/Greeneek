import { useState } from 'react'
import type { ReactNode } from 'react'
import { Menu, type MenuEntry } from '@greeneek/gnk-client-ui-primitives'
import css from './ModeSwitcher.module.css'

/** One selectable mode: a live roster preset or a parked placeholder. */
export interface ModeSwitcherEntry {
  /** Preset id staged on select; placeholders never select. */
  id: string
  /** Menu row title. */
  name: string
  /** What the mode does, shown under the name in its menu row. */
  description?: string
  /** Leading glyph, drawn on the trigger and on the mode's own row. */
  icon: ReactNode
  /** Parked placeholders render disabled and never select. */
  disabled?: boolean
}

/**
 * Render the registered modes as one menu opened by the staged mode's glyph.
 *
 * The trigger is the mode's own logo plus its name, because the glyph alone does
 * not say which mode a session is running: a dashed square, a pile of circles and
 * a brain circuit look alike to anyone who has not already opened the menu. The
 * name stays on the trigger and the sentence about what the mode does lives only
 * inside that mode's row, so the hero carries one compact control and opening it
 * answers "which one am I on" and "what would I get" in the same place.
 *
 * Every entry the caller passes becomes a row, in the order given, and the card
 * scrolls inside the viewport when the list outgrows it, so a deployment whose
 * owners have authored many presets is not truncated to a fixed count.
 *
 * `Menu` is the house dropdown, so selection, Escape, outside click, and the
 * portal that clears the composer's overflow come from the same primitive the
 * workspace picker uses. The staged mode carries the row's trailing check through
 * `selectedId`, and `aria-expanded` plus `aria-haspopup="menu"` describe the open
 * state to assistive technology in place of a native select's popup.
 *
 * A staged id the roster no longer offers — a retired preset a session still runs —
 * keeps its own id as the trigger name and gets no row and no check, so the control
 * never claims a mode the person could not have picked.
 * @param props - group label, ordered entries, staged id, selection, and busy state.
 * @returns the glyph-and-name trigger with its menu.
 */
export function ModeSwitcher({ label, entries, current, busy, onSelect }: {
  label: string
  entries: readonly ModeSwitcherEntry[]
  current: string
  busy: boolean
  onSelect: (id: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const shown = entries.find(entry => entry.id === current)
  const items: MenuEntry[] = entries.map(entry => ({
    id: entry.id,
    disabled: entry.disabled === true,
    icon: entry.icon,
    label: (
      <span className={css.itemText}>
        <span className={css.itemName}>{entry.name}</span>
        {entry.description === undefined ? null : (
          <span className={css.itemDescription}>{entry.description}</span>
        )}
      </span>
    ),
  }))

  return (
    <div className={css.root}>
      <Menu
        open={open && !busy}
        anchor={(
          <button
            type="button"
            className={open ? css.triggerOpen : css.trigger}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <span className={css.icon} aria-hidden="true">{shown?.icon}</span>
            <span className={css.triggerName}>{shown === undefined ? current : shown.name}</span>
          </button>
        )}
        items={items}
        selectedId={current}
        portal
        onSelect={(id) => {
          setOpen(false)
          onSelect(id)
        }}
        onClose={() => { setOpen(false) }}
      />
    </div>
  )
}

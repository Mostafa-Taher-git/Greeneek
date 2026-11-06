/** The composer's CTC chip: the user's reversible per-session switch between the native and lazy `both` presentations. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { MenuEntry } from '@greeneek/gnk-client-ui-primitives'
import { IconCheckOutline16, IconChevronDownOutline14, Menu } from '@greeneek/gnk-client-ui-primitives'
import type { ComposerBarProps, PresentCtcResult } from '../contract/slots.ts'
import css from './CtcSelect.module.css'

/** Composer props slice driving the chip. */
export interface CtcSelectProps {
  /** The session's folded presentation (undefined = no projection landed yet). */
  presentAs: 'native' | 'ptc' | 'both' | null | undefined
  /** The host presentation action, asked for one desired state (undefined = capability absent). */
  presentCtc: ((enabled: boolean) => Promise<PresentCtcResult>) | undefined
  /** The bar's transient banner sink for refused opt-ins. */
  showToast: (text: string) => void
  /** Whether the composer refuses interaction entirely. */
  locked: boolean
  /** The composer's bound translator. */
  t: ComposerBarProps['t']
}

/* Terminal glyph (prompt chevron + underscore) for the opt-in row. */
const codeGlyph = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3.5 4L7 8l-3.5 4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M8.5 12.5H12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

export function CtcSelect({ presentAs, presentCtc, showToast, locked, t }: CtcSelectProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Locking or losing the session face collapses an open menu like the
  // Access chip does on its own lock/value change.
  useEffect(() => {
    if (locked || presentCtc === undefined) setOpen(false)
  }, [locked, presentCtc])

  // Pre-baseline (undefined projection) and capability-absent both render
  // nothing: the chip exists for users, and a Session without a landed
  // presentation value has nothing meaningful to show yet.
  if (presentAs === undefined || presentCtc === undefined) return null

  const enabled = presentAs === 'both'
  // One row carries whichever change is actually available, so the menu never
  // offers two contradictory switches and the off state keeps a single action.
  const items: MenuEntry[] = [{
    id: enabled ? 'native' : 'both',
    label: enabled ? t('input.codeTools.offAction') : t('input.codeTools.on'),
    icon: codeGlyph,
    disabled: busy,
  }]
  const footer: MenuEntry[] = [
    {
      type: 'label',
      id: 'about',
      text: t('input.codeTools.about'),
    },
    {
      type: 'label',
      id: 'caveat',
      text: t('input.codeTools.caveat'),
    },
  ]

  const declare = (next: boolean): void => {
    if (busy) return
    setBusy(true)
    void presentCtc(next)
      .then((result) => {
        if (result.ok) {
          // The folded projection flips the trigger; close now.
          setOpen(false)
          return
        }
        if (result.reason === 'runtime-required') {
          showToast(t('input.codeTools.runtimeRequired'))
        } else if (result.reason === 'locked') {
          showToast(t('input.codeTools.locked'))
        } else if (result.reason === 'busy') {
          showToast(t('input.codeTools.busy'))
        }
        // An unavailable refusal stays silent: the Session is leaving and the
        // bar tears down over it.
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <Menu
      open={open}
      items={items}
      footer={footer}
      onSelect={(id) => {
        if (id === 'both') declare(true)
        else if (id === 'native') declare(false)
      }}
      onClose={() => { setOpen(false) }}
      side="top"
      anchor={
        <button
          type="button"
          className={css.trigger}
          aria-label={t('input.codeTools')}
          title={enabled ? undefined : t('input.codeTools.off')}
          disabled={locked || busy}
          onClick={() => { setOpen(!open) }}
        >
          {enabled && (
            <span className={css.triggerIcon} aria-hidden>
              <IconCheckOutline16 size={14} />
            </span>
          )}
          <span className={css.triggerLabel}>{t('input.codeTools')}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}

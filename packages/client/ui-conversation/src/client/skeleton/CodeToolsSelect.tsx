/** The composer's code tools chip: the user's per-session opt-in to the lazy `both` presentation. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { MenuEntry } from '@greeneek/gnk-client-ui-primitives'
import { IconCheckOutline16, IconChevronDownOutline14, Menu } from '@greeneek/gnk-client-ui-primitives'
import type { ComposerBarProps, PresentCodeToolsResult } from '../contract/slots.ts'
import css from './CodeToolsSelect.module.css'

/** Composer props slice driving the chip. */
export interface CodeToolsSelectProps {
  /** The session's folded presentation (undefined = no projection landed yet). */
  presentAs: 'native' | 'ptc' | 'both' | null | undefined
  /** The host opt-in action (undefined = capability absent). */
  presentCodeTools: (() => Promise<PresentCodeToolsResult>) | undefined
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

export function CodeToolsSelect({ presentAs, presentCodeTools, showToast, locked, t }: CodeToolsSelectProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Locking or losing the session face collapses an open menu like the
  // Access chip does on its own lock/value change.
  useEffect(() => {
    if (locked || presentCodeTools === undefined) setOpen(false)
  }, [locked, presentCodeTools])

  // Pre-baseline (undefined projection) and capability-absent both render
  // nothing: the chip exists for users, and a Session without a landed
  // presentation value has nothing meaningful to show yet.
  if (presentAs === undefined || presentCodeTools === undefined) return null

  const enabled = presentAs === 'both'
  const items: MenuEntry[] = enabled
    ? []
    : [{
      id: 'both',
      label: t('input.codeTools.on'),
      icon: codeGlyph,
      disabled: busy,
    }]
  const footer: MenuEntry[] = [{
    type: 'label',
    id: 'caveat',
    text: t('input.codeTools.caveat'),
  }]

  const enable = (): void => {
    if (busy) return
    setBusy(true)
    void presentCodeTools()
      .then((result) => {
        if (result.ok) {
          // The folded projection flips the trigger to its on state; close now.
          setOpen(false)
          return
        }
        if (result.reason === 'runtime-required') {
          showToast(t('input.codeTools.runtimeRequired'))
        } else if (result.reason === 'locked') {
          showToast(t('input.codeTools.locked'))
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
      onSelect={(id) => { if (id === 'both') enable() }}
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

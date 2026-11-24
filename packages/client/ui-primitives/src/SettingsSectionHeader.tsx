/** Heading, action row and intro shared by settings sections. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './SettingsSectionHeader.module.css'

/**
 * Render a settings section's heading, owner actions and intro copy.
 * @param props.title - already-localized heading.
 * @param props.intro - already-localized intro paragraph.
 * @param props.closeLabel - already-localized name of the close control.
 * @param props.onClose - leaves the section.
 * @param props.actionsClassName - owner class supplying the action row spacing.
 * @param props.children - owner actions placed before the close control.
 * @returns the heading and intro elements.
 */
export function SettingsSectionHeader({
  title, intro, closeLabel, onClose, actionsClassName, children,
}: {
  title: string
  intro: string
  closeLabel: string
  onClose: () => void
  actionsClassName?: string | undefined
  children?: ReactNode
}) {
  return (
    <>
      <div className={css.header}>
        <h2 className={css.title}>{title}</h2>
        <div className={clsx(css.actions, actionsClassName)}>
          {children}
          <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>✕</button>
        </div>
      </div>
      <p className={css.intro}>{intro}</p>
    </>
  )
}

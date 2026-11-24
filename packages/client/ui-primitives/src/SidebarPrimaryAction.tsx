/** Sidebar primary action shared by the surfaces that register into the rail. */
import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip.tsx'
import css from './SidebarPrimaryAction.module.css'

/**
 * Render a labelled row when wide, the rail icon otherwise.
 * @param props.wide - render the expanded row instead of the rail icon.
 * @param props.label - already-localized action name.
 * @param props.icon - icon element shown in both forms.
 * @param props.onClick - opens the target surface.
 * @returns the tooltip-wrapped action button.
 */
export function SidebarPrimaryAction({ wide, label, icon, onClick }: {
  wide: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={`${css.action}${wide ? '' : ` ${css.rail}`}`}
        aria-label={label}
        onClick={onClick}
      >
        {icon}
        {wide && <span className={css.label}>{label}</span>}
      </button>
    </Tooltip>
  )
}

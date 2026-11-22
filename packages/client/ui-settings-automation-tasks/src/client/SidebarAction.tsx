/** Sidebar shortcut that opens the Automation tasks settings section. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
// Type-only: pulls the sidebar primary-action SlotMap seat into this program.
import type {} from '@greeneek/gnk-client-ui-sidebar/client'
import { IconClockOutline16, Tooltip } from '@greeneek/gnk-client-ui-primitives'
import css from './SidebarAction.module.css'

/** Registration-side face. */
export interface SidebarActionInjected {
  /** Open the Automation tasks section. */
  open: () => void
}

/** Full trigger props. */
export type SidebarActionProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'settings.automationTasks'>
  & InjectFace<SidebarActionInjected>

/** Render the labelled row when wide, the rail icon otherwise. */
export function SidebarAction({ wide, t, open }: SidebarActionProps) {
  return (
    <Tooltip label={t('nav')} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={`${css.action}${wide ? '' : ` ${css.rail}`}`}
        aria-label={t('nav')}
        onClick={open}
      >
        <IconClockOutline16 size={14} />
        {wide && <span className={css.label}>{t('nav')}</span>}
      </button>
    </Tooltip>
  )
}

/** Dashboard trigger in the sidebar, directly under New Session. */
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import { IconDashboardOutline16, Tooltip } from '@greeneek/gnk-client-ui-primitives'
// Type-only: pulls the sidebar primary-action slot declaration.
import type {} from '@greeneek/gnk-client-ui-sidebar/client'
import css from './DashboardAction.module.css'

/** Registration-side face: open the Dashboard page through the layout. */
export interface DashboardActionInjected {
  /** Show the Dashboard in the main column. */
  openDashboard: () => void
}

/** Full trigger props. */
export type DashboardActionProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'workspace'>
  & InjectFace<DashboardActionInjected>

/**
 * Render the Dashboard entry.
 * @param props - column state, dictionary, and the layout action.
 * @returns the labelled row when wide, the rail icon otherwise.
 */
export function DashboardAction({ wide, t, openDashboard }: DashboardActionProps) {
  return (
    <Tooltip label={t('dashboard.open')} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={clsx(css.action, !wide && css.rail)}
        aria-label={t('dashboard.open')}
        onClick={openDashboard}
      >
        <IconDashboardOutline16 size={14} />
        {wide && <span className={css.label}>{t('dashboard.open')}</span>}
      </button>
    </Tooltip>
  )
}

/** Sidebar entry that opens the standalone Deep-agent page. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type {} from '@greeneek/gnk-client-ui-sidebar/client'
import { IconBrainCircuit16, Tooltip } from '@greeneek/gnk-client-ui-primitives'
import css from './SidebarAction.module.css'

/** Registration-side face. */
export interface SidebarActionInjected {
  /** Open the Deep-agent page. */
  open: () => void
}

export type SidebarActionProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'deepAgent'>
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
        <IconBrainCircuit16 size={14} />
        {wide && <span className={css.label}>{t('nav')}</span>}
      </button>
    </Tooltip>
  )
}

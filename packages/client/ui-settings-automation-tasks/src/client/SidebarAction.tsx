/** Sidebar shortcut that opens the Automation tasks settings section. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
// Type-only: pulls the sidebar primary-action SlotMap seat into this program.
import type {} from '@greeneek/gnk-client-ui-sidebar/client'
import { IconClockOutline16, SidebarPrimaryAction } from '@greeneek/gnk-client-ui-primitives'

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

/** Render the shared rail action with the Automation tasks label and icon. */
export function SidebarAction({ wide, t, open }: SidebarActionProps) {
  return <SidebarPrimaryAction wide={wide} label={t('nav')} icon={<IconClockOutline16 size={14} />} onClick={open} />
}

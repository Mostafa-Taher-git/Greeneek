/** Sidebar shortcut that opens the Plugins settings section. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
// Type-only: pulls the sidebar primary-action SlotMap seat into this program.
import type {} from '@greeneek/gnk-client-ui-sidebar/client'
import { IconPuzzle16, SidebarPrimaryAction } from '@greeneek/gnk-client-ui-primitives'

/** Registration-side face. */
export interface SidebarActionInjected {
  /** Open the Plugins section. */
  open: () => void
}

/** Full trigger props. */
export type SidebarActionProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'settings.pluginManager'>
  & InjectFace<SidebarActionInjected>

/** Render the shared rail action with the Plugins label and icon. */
export function SidebarAction({ wide, t, open }: SidebarActionProps) {
  return <SidebarPrimaryAction wide={wide} label={t('nav')} icon={<IconPuzzle16 size={14} />} onClick={open} />
}

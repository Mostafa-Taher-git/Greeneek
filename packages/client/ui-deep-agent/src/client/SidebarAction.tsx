/** Sidebar entry that opens the standalone Deep-agent page. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type {} from '@greeneek/gnk-client-ui-sidebar/client'
import { IconWolf16, SidebarPrimaryAction } from '@greeneek/gnk-client-ui-primitives'

/** Registration-side face. */
export interface SidebarActionInjected {
  /** Open the Deep-agent page. */
  open: () => void
}

export type SidebarActionProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'deepAgent'>
  & InjectFace<SidebarActionInjected>

/** Render the shared rail action with the Deep-agent label and icon. */
export function SidebarAction({ wide, t, open }: SidebarActionProps) {
  return <SidebarPrimaryAction wide={wide} label={t('nav')} icon={<IconWolf16 size={14} />} onClick={open} />
}

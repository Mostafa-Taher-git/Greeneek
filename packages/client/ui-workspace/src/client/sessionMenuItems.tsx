/**
 * The menu rows the Session surfaces share.
 *
 * The conversation header and the sidebar row offer the same Session verbs.
 * The rows live here so both surfaces stay in step: one label, one shortcut
 * hint, one icon per verb.
 */
import {
  IconBranchOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  formatShortcut,
  type MenuItem,
} from '@greeneek/gnk-client-ui-primitives'
import type { WorkspaceBrowserProps } from './contract/slots.ts'

/** The locale seat the shared rows are written in. */
type MenuTranslate = WorkspaceBrowserProps['t']

/**
 * The verbs every Session surface offers, in presentation order.
 * @param t - the workspace locale seat.
 * @returns the shared menu rows.
 */
export function sharedSessionMenuItems(t: MenuTranslate): MenuItem[] {
  return [
    {
      id: 'rename',
      label: t('rename'),
      icon: <IconEditOutline16 />,
      hint: formatShortcut('mod+alt+g'),
    },
    {
      id: 'fork',
      label: t('menu.fork'),
      icon: <IconBranchOutline16 />,
      hint: formatShortcut('mod+alt+f'),
    },
    {
      id: 'copy-id',
      label: t('menu.copySessionId'),
      icon: <IconCopyOutline16 />,
    },
  ]
}

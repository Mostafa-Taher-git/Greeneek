import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconBranchOutline16,
  IconDownloadOutline16,
  IconEllipsisOutline16,
  Menu,
  type MenuEntry,
} from '@greeneek/gnk-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

const VIEW_TRAJECTORY = 'trajectory'
const VIEW_CHAT = 'chat'

/**
 * Render the Session Header utilities menu and its shared result dialog: a
 * plain kebab button opening the view switcher and the Session export.
 * The view item names its destination — Trajectory from Chat, Chat back from
 * Trajectory — because the tab strip is Chat-only and the trajectory view
 * would otherwise strand with no way back.
 * @param props - Session runtime, download controller, view navigation, and localized copy.
 * @returns the kebab menu and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  const { sessionId, request, selectView, activeView, t } = props
  const [open, setOpen] = useState(false)
  const inTrajectory = activeView === VIEW_TRAJECTORY
  const items: readonly MenuEntry[] = [
    {
      id: 'view',
      label: inTrajectory ? t('menu.chat') : t('menu.trajectory'),
      icon: <IconBranchOutline16 size={14} />,
    },
    {
      id: 'export',
      label: t('header.action'),
      icon: <IconDownloadOutline16 size={14} />,
    },
  ]
  const choose = (id: string): void => {
    setOpen(false)
    if (id === 'view') selectView?.(inTrajectory ? VIEW_CHAT : VIEW_TRAJECTORY)
    else void request(sessionId)
  }

  return (
    <>
      <Menu
        open={open}
        anchor={(
          <button
            type="button"
            className={css.menuButton}
            aria-label={t('menu.button')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(!open) }}
          >
            <IconEllipsisOutline16 size={14} className={css.kebab} />
          </button>
        )}
        items={items}
        onSelect={choose}
        onClose={() => { setOpen(false) }}
        align="end"
        side="bottom"
      />
      <SessionLogDownloadDialog {...props} />
    </>
  )
}

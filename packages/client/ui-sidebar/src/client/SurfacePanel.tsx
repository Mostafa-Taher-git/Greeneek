/**
 * Independent right panel: an "Open a surface" launcher shaped after T3's
 * right sidebar. Every row names a destination this app actually has — no
 * placeholder Browser/Files/Diff rows — and the only shortcut chip shown is
 * one the keyboard handler really binds. Selecting a row navigates; the panel
 * stays open so the two titlebar toggles remain independent.
 */
import {
  IconBranchOutline16,
  IconCodeOutline16,
  IconDashboardOutline16,
  IconNewChatOutline16,
  IconSettingsOutline16,
  formatShortcut,
  type IconProps,
} from '@greeneek/gnk-client-ui-primitives'
import type { SurfacePanelComponentProps } from './contract/slots.ts'
import type { SidebarKey } from './locales.ts'
import css from './SurfacePanel.module.css'

/** One launcher row: glyph, localized name, optional real shortcut, destination. */
interface SurfaceSpec {
  /** Stable row identity. */
  id: 'terminal' | 'trajectory' | 'chat' | 'settings' | 'dashboard'
  /** The 16px glyph. */
  icon: (props: IconProps) => React.ReactNode
  /** Localized row name. */
  labelKey: SidebarKey
  /** A shortcut the keyboard handler already binds, when one exists. */
  shortcut?: string
  /** Navigate to the destination. */
  open: () => void
}

/**
 * Render the right-panel surface launcher.
 * @param props - the Session scope, the five navigation verbs, and the locale seat.
 * @returns the centred heading and the destination rows.
 */
export function SurfacePanel({
  sessionId, openTerminal, openTrajectory, openChat, openSettings, openDashboard, t,
}: SurfacePanelComponentProps) {
  const surfaces: SurfaceSpec[] = [
    {
      id: 'terminal',
      icon: IconCodeOutline16,
      labelKey: 'surface.terminal',
      shortcut: 'mod+j',
      open: openTerminal,
    },
    {
      id: 'trajectory',
      icon: IconBranchOutline16,
      labelKey: 'surface.trajectory',
      open: () => { openTrajectory(sessionId) },
    },
    {
      id: 'chat',
      icon: IconNewChatOutline16,
      labelKey: 'surface.chat',
      open: () => { openChat(sessionId) },
    },
    {
      id: 'settings',
      icon: IconSettingsOutline16,
      labelKey: 'surface.settings',
      open: openSettings,
    },
    {
      id: 'dashboard',
      icon: IconDashboardOutline16,
      labelKey: 'surface.dashboard',
      open: openDashboard,
    },
  ]

  return (
    <div className={css.root} data-surface-panel="">
      <h2 className={css.heading}>{t('surface.heading')}</h2>
      <div className={css.list}>
        {surfaces.map(surface => (
          <button
            key={surface.id}
            type="button"
            className={css.row}
            aria-label={t(surface.labelKey)}
            onClick={surface.open}
          >
            <surface.icon size={16} className={css.icon} />
            <span className={css.label}>{t(surface.labelKey)}</span>
            {surface.shortcut !== undefined && (
              <kbd className={css.shortcut}>{formatShortcut(surface.shortcut)}</kbd>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

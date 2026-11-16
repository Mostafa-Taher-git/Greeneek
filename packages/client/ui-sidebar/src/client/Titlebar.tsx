/**
 * Frameless-desktop titlebar (T3-shaped): one 52px row carrying the window
 * drag surface. Inline start: the Greeneek brand and the current session
 * title — a button that returns to that Session's Chat view; reading end: the
 * three session panel toggles — thread details, terminal drawer, right panel —
 * exactly the controls T3 pins here. The desktop-injected window controls sit
 * beyond them; their inline-end space stays reserved by padding on the desktop
 * host only. Mounting in a desktop host marks documentElement so the desktop
 * skips its overlay drag strip (the splash, which has no web titlebar, still
 * gets one). Double-click toggles maximize through the preload bridge; without
 * one it is a no-op.
 */
import { useEffect } from 'react'
import {
  FishLogo,
  IconPanelBottomOutline16,
  IconPanelLeftOutline16,
  IconPanelRightOutline16,
  IconPanelSquareMenuOutline16,
  IconPlusOutline16,
  Tooltip,
  formatShortcut,
  type IconProps,
} from '@greeneek/gnk-client-ui-primitives'
import clsx from 'clsx'
import type { TitlebarComponentProps } from './contract/slots.ts'
import css from './Titlebar.module.css'

/** One toggle button face: icon, localized name, shortcut hint, pressed state. */
interface PanelToggleSpec {
  /** TypeScript tag for the panel; used by the icon element only. */
  id: 'threadDetails' | 'terminalDrawer' | 'rightPanel'
  /** The icon glyph; its accessible name comes from the button's aria-label. */
  icon: (props: IconProps) => React.ReactNode
  /** The aria-label copy from the sidebar namespace. */
  labelKey: 'toggle.threadDetails.aria' | 'toggle.terminalDrawer.aria' | 'toggle.rightPanel.aria'
  /** Shortcut spec the keyboard handler already binds (mod+shift+b / mod+j / mod+alt+b). */
  shortcut: string
  /** Live open state straight from the frame. */
  open: boolean
  /** Invoke the toggle. */
  toggle: () => void
}

/** The preload bridge, when this page runs inside the desktop shell. */
function desktopBridge(): { windowToggleMaximize?: () => void } | undefined {
  return (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop as
    | { windowToggleMaximize?: () => void }
    | undefined
}

/**
 * Render the desktop titlebar row.
 * @param props - panel controls, document title, the current Session, the
 * Chat-return callback, and the locale seat.
 * @returns the drag bar with its title control and panel toggles.
 */
export function Titlebar({
  documentTitle, panelControls, sessionId, sidebarCollapsed, openChat, toggleSidebar, startSession, t,
}: TitlebarComponentProps) {
  const desktopHost = desktopBridge() !== undefined
  useEffect(() => {
    // A browser page has no overlay drag strip to stand down.
    if (!desktopHost) return
    document.documentElement.setAttribute('data-desktop-titlebar', '')
    return () => {
      document.documentElement.removeAttribute('data-desktop-titlebar')
    }
  }, [desktopHost])

  const title = documentTitle

  const toggles: PanelToggleSpec[] = panelControls === undefined
    ? []
    : [
      {
        id: 'threadDetails',
        icon: IconPanelSquareMenuOutline16,
        labelKey: 'toggle.threadDetails.aria',
        shortcut: 'mod+shift+b',
        open: panelControls.threadDetailsOpen,
        toggle: panelControls.toggleThreadDetails,
      },
      {
        id: 'terminalDrawer',
        icon: IconPanelBottomOutline16,
        labelKey: 'toggle.terminalDrawer.aria',
        shortcut: 'mod+j',
        open: panelControls.terminalDrawerOpen,
        toggle: panelControls.toggleTerminalDrawer,
      },
      {
        id: 'rightPanel',
        icon: IconPanelRightOutline16,
        labelKey: 'toggle.rightPanel.aria',
        shortcut: 'mod+alt+b',
        open: panelControls.rightPanelOpen,
        toggle: panelControls.toggleRightPanel,
      },
    ]

  return (
    <div
      className={css.bar}
      data-titlebar=""
      data-desktop-host={desktopHost || undefined}
      onDoubleClick={() => {
        const toggleMaximize = desktopBridge()?.windowToggleMaximize
        if (typeof toggleMaximize === 'function') toggleMaximize()
      }}
    >
      {/* Leading chrome controls, before the brand: the sidebar toggle is the
          only way back in once the sidebar fully closes, and New Session stays
          one gesture away without the rail. */}
      <div className={css.startGroup}>
        <Tooltip
          label={t(sidebarCollapsed ? 'toggle.open' : 'toggle.collapse')}
          side="bottom"
          delayMs={500}
        >
          <button
            type="button"
            className={css.panelButton}
            aria-label={t(sidebarCollapsed ? 'toggle.open' : 'toggle.collapse')}
            aria-pressed={!sidebarCollapsed}
            data-panel-toggle="sidebar"
            onClick={() => { toggleSidebar() }}
          >
            <IconPanelLeftOutline16 size={16} />
          </button>
        </Tooltip>
        <Tooltip label={t('session.new.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.panelButton}
            aria-label={t('session.new.label')}
            data-titlebar-new-session
            onClick={() => { startSession() }}
          >
            <IconPlusOutline16 size={16} />
          </button>
        </Tooltip>
      </div>
      <span className={css.brand}>
        <span aria-hidden="true" className={css.brandMark}>
          <FishLogo size={16} />
        </span>
        <span className={css.brandName}>{t('brand.name')}</span>
      </span>
      {title !== undefined && title !== '' && (
        <span className={css.titleCluster}>
          <span aria-hidden="true" className={css.separator}>/</span>
          {sessionId === undefined
            ? <span className={css.title} title={title}>{title}</span>
            : (
              <button
                type="button"
                className={clsx(css.title, css.titleButton)}
                title={t('titlebar.returnToChat', { title })}
                aria-label={t('titlebar.returnToChat', { title })}
                onClick={() => { openChat(sessionId) }}
              >
                {title}
              </button>
            )}
        </span>
      )}
      <span className={css.spacer} />
      <div className={css.panelGroup}>
        {toggles.map(spec => (
          <Tooltip
            key={spec.id}
            label={`${t(spec.labelKey)} (${formatShortcut(spec.shortcut)})`}
            side="bottom"
            delayMs={500}
          >
            <button
              type="button"
              className={clsx(css.panelButton, spec.open && css.panelButtonActive)}
              aria-label={t(spec.labelKey)}
              aria-pressed={spec.open}
              data-panel-toggle={spec.id}
              onClick={() => { spec.toggle() }}
            >
              <spec.icon size={16} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

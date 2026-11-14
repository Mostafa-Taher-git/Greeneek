/**
 * Frameless-desktop titlebar (T3-shaped): one 52px row carrying the window
 * drag surface. Inline start: the Greeneek brand and the current session
 * title; reading end: the three session panel toggles — thread details,
 * terminal drawer, right panel — exactly the controls T3 pins here. The
 * desktop-injected window controls sit beyond them; their inline-end space
 * stays reserved by padding. Mounting marks documentElement so the desktop
 * skips its overlay drag strip (the splash, which has no web titlebar, still
 * gets one). Double-click toggles maximize through the preload bridge;
 * without one it is a no-op.
 */
import { useEffect } from 'react'
import {
  FishLogo,
  IconPanelBottomOutline16,
  IconPanelRightOutline16,
  IconPanelSquareMenuOutline16,
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

/**
 * Render the desktop titlebar row.
 * @param props - panel controls, document title, the locale seat.
 * @returns the drag bar with its panel toggle controls.
 */
export function Titlebar({ documentTitle, panelControls, t }: TitlebarComponentProps) {
  useEffect(() => {
    document.documentElement.setAttribute('data-desktop-titlebar', '')
    return () => {
      document.documentElement.removeAttribute('data-desktop-titlebar')
    }
  }, [])

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
      onDoubleClick={() => {
        const bridge = (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop as
          | { windowToggleMaximize?: () => void }
          | undefined
        const toggleMaximize = bridge?.windowToggleMaximize
        if (typeof toggleMaximize === 'function') toggleMaximize()
      }}
    >
      <span className={css.brand}>
        <span aria-hidden="true" className={css.brandMark}>
          <FishLogo size={16} />
        </span>
        <span className={css.brandName}>{t('brand.name')}</span>
      </span>
      {title !== undefined && title !== '' && (
        <span className={css.title} title={title}>/ {title}</span>
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

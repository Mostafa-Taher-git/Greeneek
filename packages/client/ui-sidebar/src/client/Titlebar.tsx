/**
 * Frameless-desktop titlebar (Claude-style): one 40px row, sidebar toggle
 * left, desktop-injected window controls right. The bar itself is the
 * window drag region; the toggle opts out via no-drag. Mounting marks
 * documentElement so the desktop skips its overlay drag strip (the splash,
 * which has no web titlebar, still gets one). Double-click toggles
 * maximize through the preload bridge; without one it is a no-op.
 */
import { useEffect } from 'react'
import { IconPanelLeftOutline16, Tooltip } from '@greeneek/gnk-client-ui-primitives'
import type { TitlebarComponentProps } from './contract/slots.ts'
import css from './Titlebar.module.css'

/**
 * Render the desktop titlebar row.
 * @param props - collapsed flag (owner) + toggle callback (injected) + the
 * sidebar locale seat.
 * @returns the drag bar with its toggle control.
 */
export function Titlebar({ collapsed, toggleSidebar, t }: TitlebarComponentProps) {
  useEffect(() => {
    document.documentElement.setAttribute('data-desktop-titlebar', '')
    return () => {
      document.documentElement.removeAttribute('data-desktop-titlebar')
    }
  }, [])

  return (
    <div
      className={css.bar}
      onDoubleClick={() => {
        const bridge = (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop as
          | { windowToggleMaximize?: () => void }
          | undefined
        const toggleMaximize = bridge?.windowToggleMaximize
        if (typeof toggleMaximize === 'function') toggleMaximize()
      }}
    >
      <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
        <button
          type="button"
          className={css.toggle}
          aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
          aria-expanded={!collapsed}
          onClick={() => { toggleSidebar() }}
        >
          <IconPanelLeftOutline16 size={16} />
        </button>
      </Tooltip>
    </div>
  )
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionPanelControls } from '@greeneek/gnk-client-ui-layout/client'
import type { TitlebarComponentProps } from '../src/client/contract/slots.ts'
import { Titlebar } from '../src/client/Titlebar.tsx'
import { zh } from '../src/client/locales.ts'

const t: TitlebarComponentProps['t'] = key => (zh as Record<string, string>)[key] ?? key

// The titlebar reads no global hooks, but they ride the standard props
// share; stub them as never-called functions.
const neverHook = (() => { throw new Error('titlebar must not read global hooks') }) as never

function panelControls(over: Partial<SessionPanelControls> = {}): SessionPanelControls {
  return {
    threadDetailsOpen: false,
    terminalDrawerOpen: false,
    rightPanelOpen: false,
    toggleThreadDetails: vi.fn(),
    toggleTerminalDrawer: vi.fn(),
    toggleRightPanel: vi.fn(),
    ...over,
  }
}

function mount(props: Partial<TitlebarComponentProps> = {}) {
  // Return exactly the object the frame renders with (tests may pass their own).
  const controls = props.panelControls ?? panelControls()
  render(
    <Titlebar
      useSessions={neverHook} useSessionPendingInteraction={neverHook} useWorkspaces={neverHook}
      t={t}
      panelControls={controls}
      {...props}
    />,
  )
  return { controls }
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-desktop-titlebar')
})

describe('Titlebar', () => {
  it('marks documentElement so the desktop skips its overlay strip', () => {
    mount()
    expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(true)
  })

  it('double-click is a no-op without the preload bridge', () => {
    mount()
    const bar = document.querySelector('[data-titlebar]')
    expect(bar).not.toBeNull()
    expect(() => fireEvent.doubleClick(bar!)).not.toThrow()
  })

  it('renders exactly the three panel toggles, and nothing else', () => {
    mount()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      '切换线程详情',
      '切换终端抽屉',
      '切换右侧面板',
    ])
  })

  it('renders exactly the three panel toggles, with aria-pressed state', () => {
    const { controls } = mount({
      panelControls: panelControls({ threadDetailsOpen: true, rightPanelOpen: true }),
    })
    const pressed = (name: string): string | null =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed')
    expect(pressed('切换线程详情')).toBe('true')
    expect(pressed('切换终端抽屉')).toBe('false')
    expect(pressed('切换右侧面板')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '切换终端抽屉' }))
    fireEvent.click(screen.getByRole('button', { name: '切换线程详情' }))
    fireEvent.click(screen.getByRole('button', { name: '切换右侧面板' }))
    expect(controls.toggleTerminalDrawer).toHaveBeenCalledOnce()
    expect(controls.toggleThreadDetails).toHaveBeenCalledOnce()
    expect(controls.toggleRightPanel).toHaveBeenCalledOnce()
  })

  it('shows the document title when the frame supplies one', () => {
    mount({ documentTitle: 'ping' })
    expect(screen.getByTitle('ping').textContent).toBe('/ ping')
  })

  it('renders the brand alone when the hero supplies no document title', () => {
    mount()
    // 'Greeneek' is the sidebar brand name; the brand must appear exactly once.
    expect(screen.getAllByText('Greeneek')).toHaveLength(1)
    expect(screen.queryByText(/^\//u)).toBeNull()
  })

  it('does not render the sidebar fold toggle anywhere', () => {
    mount({ documentTitle: 'ping' })
    expect(screen.queryByRole('button', { name: '收起侧边栏' })).toBeNull()
    expect(screen.queryByRole('button', { name: '打开侧边栏' })).toBeNull()
  })

  it('renders empty panel-control seat when the frame passes nothing', () => {
    mount({ panelControls: undefined })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import type { SessionPanelControls } from '@greeneek/gnk-client-ui-layout/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { TitlebarComponentProps } from '../src/client/contract/slots.ts'
import { Titlebar } from '../src/client/Titlebar.tsx'
import { zh } from '../src/client/locales.ts'

// The component interpolates {title} into the return affordance; build the
// seat the way the runtime binds it.
const t: TitlebarComponentProps['t'] = makeTranslate(zh)
const SID = 's1' as SessionId

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
  const openChat = props.openChat ?? vi.fn()
  const toggleSidebar = props.toggleSidebar ?? vi.fn()
  const startSession = props.startSession ?? vi.fn()
  render(
    <Titlebar
      useSessions={neverHook} useSessionPendingInteraction={neverHook} useWorkspaces={neverHook}
      t={t}
      panelControls={controls}
      openChat={openChat}
      toggleSidebar={toggleSidebar}
      startSession={startSession}
      {...props}
    />,
  )
  return { controls, openChat, toggleSidebar, startSession }
}

/** Install (or remove) the desktop preload bridge for one case. */
function desktopBridge(toggleMaximize?: () => void): void {
  if (toggleMaximize === undefined) {
    Reflect.deleteProperty(globalThis, 'greeneekDesktop')
  } else {
    (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop = { windowToggleMaximize: toggleMaximize }
  }
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-desktop-titlebar')
  desktopBridge()
})

describe('Titlebar', () => {
  it('leaves documentElement unmarked without the desktop bridge', () => {
    mount()
    expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(false)
  })

  it('marks documentElement only inside the desktop host, and unmarks on unmount', () => {
    desktopBridge(vi.fn())
    const view = render(<Titlebar
      useSessions={neverHook} useSessionPendingInteraction={neverHook} useWorkspaces={neverHook}
      t={t} openChat={vi.fn()} toggleSidebar={vi.fn()} startSession={vi.fn()}
    />)
    expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(true)
    view.unmount()
    expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(false)
  })

  it('flags the bar as desktop-hosted only with the bridge', () => {
    mount()
    expect(document.querySelector('[data-titlebar]')?.hasAttribute('data-desktop-host')).toBe(false)
    cleanup()
    desktopBridge(vi.fn())
    mount()
    expect(document.querySelector('[data-titlebar]')?.hasAttribute('data-desktop-host')).toBe(true)
  })

  it('double-click is a no-op without the preload bridge', () => {
    mount()
    const bar = document.querySelector('[data-titlebar]')
    expect(bar).not.toBeNull()
    expect(() => fireEvent.doubleClick(bar!)).not.toThrow()
  })

  it('double-click toggles maximize through the preload bridge', () => {
    const toggleMaximize = vi.fn()
    desktopBridge(toggleMaximize)
    mount()
    fireEvent.doubleClick(document.querySelector('[data-titlebar]')!)
    expect(toggleMaximize).toHaveBeenCalledOnce()
  })

  it('renders the two leading controls before the brand, then the three panel toggles', () => {
    mount()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      '收起侧边栏',
      '新建会话',
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

  it('shows the document title as plain text without a current Session', () => {
    mount({ documentTitle: 'ping' })
    // Cluster reads "brand / title"; the separator is its own span.
    expect(screen.getByTitle('ping').textContent).toBe('ping')
    expect(screen.getByText('/')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /返回对话/ })).toBeNull()
  })

  it('renders the brand alone when the frame supplies no document title', () => {
    mount()
    // 'Greeneek' is the sidebar brand name; the brand must appear exactly once.
    expect(screen.getAllByText('Greeneek')).toHaveLength(1)
    expect(screen.queryByText(/^\//u)).toBeNull()
  })

  it('the title is a button that returns to the Session Chat view', () => {
    const { openChat } = mount({ documentTitle: 'my thread', sessionId: SID })
    const titleButton = screen.getByRole('button', { name: '返回对话：my thread' })
    expect(titleButton.textContent).toBe('my thread')
    fireEvent.click(titleButton)
    expect(openChat).toHaveBeenCalledOnce()
    expect(openChat).toHaveBeenCalledWith(SID)
  })

  it('drives the sidebar toggle and New Session from the leading buttons', () => {
    const { toggleSidebar, startSession } = mount()
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
    expect(toggleSidebar).toHaveBeenCalledOnce()
    expect(startSession).toHaveBeenCalledOnce()
  })

  it('labels and presses the sidebar toggle from the frame state', () => {
    mount({ sidebarCollapsed: true })
    const toggle = screen.getByRole('button', { name: '打开侧边栏' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps the two leading controls when the frame passes no panel controls', () => {
    mount({ panelControls: undefined })
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})

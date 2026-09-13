// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TitlebarComponentProps } from '../src/client/contract/slots.ts'
import { Titlebar } from '../src/client/Titlebar.tsx'
import { zh } from '../src/client/locales.ts'

const t: TitlebarComponentProps['t'] = key => (zh as Record<string, string>)[key] ?? key

// The titlebar reads no global hooks, but they ride the standard props
// share; stub them as never-called functions.
const neverHook = (() => { throw new Error('titlebar must not read global hooks') }) as never

function mount(props: Partial<TitlebarComponentProps> = {}) {
  const toggleSidebar = vi.fn()
  render(
    <Titlebar
      collapsed={false}
      useSessions={neverHook} useSessionPendingInteraction={neverHook} useWorkspaces={neverHook}
      toggleSidebar={toggleSidebar}
      t={t}
      {...props}
    />,
  )
  return { toggleSidebar }
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-desktop-titlebar')
})

describe('Titlebar', () => {
  it('toggles the sidebar with the collapsed-aware label', () => {
    const { toggleSidebar } = mount()
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(toggleSidebar).toHaveBeenCalledOnce()
  })

  it('offers to open while collapsed', () => {
    mount({ collapsed: true })
    expect(screen.getByRole('button', { name: '打开侧边栏' })).toBeTruthy()
  })

  it('marks documentElement so the desktop skips its overlay strip', () => {
    mount()
    expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(true)
  })

  it('double-click is a no-op without the preload bridge', () => {
    mount()
    const bar = screen.getByRole('button', { name: '收起侧边栏' }).closest('div')
    expect(() => fireEvent.doubleClick(bar!)).not.toThrow()
  })
})

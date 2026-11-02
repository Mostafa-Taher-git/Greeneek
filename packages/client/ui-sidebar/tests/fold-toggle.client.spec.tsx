// @vitest-environment jsdom
/**
 * S0-10: the Web host's sidebar fold control. The desktop titlebar owns the
 * toggle there, so the column must render none; on the Web host no titlebar row
 * exists, so the column carries the one control and drives it through the
 * layout service's `toggleSidebar`. Real keyboard activation is exercised by
 * the Playwright Web scenarios (`press Enter` on the focused button); here the
 * unit asserts the control is a native button, which browsers activate from
 * the keyboard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SidebarRootComponentProps, SidebarSectionOwnerProps } from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { ar, en, zh } from '../src/client/locales.ts'

const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SidebarRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

afterEach(cleanup)

/**
 * Render the shell with the host and column state under test.
 * @param props Host flag and live column state.
 * @returns the rendered view plus the toggle call spy.
 */
function mount(props: { desktopHost: boolean; collapsed: boolean }): { toggle: () => void } {
  const toggle = vi.fn()
  render(
    <SidebarRoot
      collapsed={props.collapsed} width={props.collapsed ? 56 : 300} desktopHost={props.desktopHost}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={toggle} t={t}
      renderSlot={((_key: string, _owner: SidebarSectionOwnerProps) => null) as SidebarRootComponentProps['renderSlot']}
    />,
  )
  return { toggle }
}

describe('sidebar fold control', () => {
  it('offers the collapse action on the Web host while the column is open', () => {
    mount({ desktopHost: false, collapsed: false })
    const button = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('flips the accessible name and expanded state once the column is a rail', () => {
    mount({ desktopHost: false, collapsed: true })
    const button = screen.getByRole('button', { name: 'Open sidebar' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
  })

  it('routes the click through the layout service rather than local state', () => {
    const { toggle } = mount({ desktopHost: false, collapsed: false })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('renders no column toggle on the desktop host, where the titlebar owns it', () => {
    mount({ desktopHost: true, collapsed: false })
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open sidebar' })).toBeNull()
  })

  it('names the control in every shipped locale', () => {
    for (const [locale, dictionary] of [['en', en], ['zh', zh], ['ar', ar]] as const) {
      const labels = dictionary as unknown as Record<string, string>
      expect(labels['toggle.collapse'], locale).toBeTruthy()
      expect(labels['toggle.open'], locale).toBeTruthy()
    }
  })
})

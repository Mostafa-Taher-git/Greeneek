// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { formatShortcut } from '@greeneek/gnk-client-ui-primitives'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { SurfacePanelComponentProps } from '../src/client/contract/slots.ts'
import { SurfacePanel } from '../src/client/SurfacePanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: SurfacePanelComponentProps['t'] = makeTranslate(zh)
const SID = 's1' as SessionId

function mount(overrides: Partial<SurfacePanelComponentProps> = {}) {
  const verbs = {
    openTerminal: vi.fn(),
    openTrajectory: vi.fn(),
    openChat: vi.fn(),
    openSettings: vi.fn(),
    openDashboard: vi.fn(),
  }
  const props = {
    sessionId: SID,
    t,
    ...verbs,
    ...overrides,
  } as unknown as SurfacePanelComponentProps
  render(<SurfacePanel {...props} />)
  return verbs
}

describe('SurfacePanel', () => {
  it('lists only the destinations this app actually has', () => {
    mount()
    expect(screen.getByRole('heading', { name: '打开一个面板' })).toBeTruthy()
    for (const label of ['终端', '执行轨迹', '对话', '设置', '仪表盘']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(screen.queryByText('Browser')).toBeNull()
    expect(screen.queryByText('Pull request')).toBeNull()
  })

  it('shows a shortcut chip only for the bound terminal shortcut', () => {
    mount()
    expect(screen.getByText(formatShortcut('mod+j'))).toBeTruthy()
    expect(document.querySelectorAll('kbd')).toHaveLength(1)
  })

  it('opens the terminal drawer from its row', () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '终端' }))
    expect(verbs.openTerminal).toHaveBeenCalledOnce()
  })

  it('opens the two Session views with the current Session', () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '执行轨迹' }))
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(verbs.openTrajectory).toHaveBeenCalledWith(SID)
    expect(verbs.openChat).toHaveBeenCalledWith(SID)
  })

  it('opens the two full-page destinations', () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '仪表盘' }))
    expect(verbs.openSettings).toHaveBeenCalledOnce()
    expect(verbs.openDashboard).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@greeneek/gnk-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@greeneek/gnk-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    openSettings: vi.fn(),
    selectSettingsSection: vi.fn(),
    showConversation: vi.fn(),
    openDashboard: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the three panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()
    service.openSettings('models')
    service.selectSettingsSection('general')
    service.showConversation()

    expect(panels.openSettings).toHaveBeenCalledWith('models')
    expect(panels.selectSettingsSection).toHaveBeenCalledWith('general')
    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.showConversation).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.openSettings() }).toThrow(/panel actions not wired/)
    expect(() => { service.selectSettingsSection('general') }).toThrow(/panel actions not wired/)
    expect(() => { service.showConversation() }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})

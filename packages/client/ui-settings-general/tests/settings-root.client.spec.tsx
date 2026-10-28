// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import type { SettingsPageComponentProps, SettingsRootComponentProps } from '../src/client/shell-contract.ts'
import { SettingsPage, SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type Row = { id: string; order: number; label: string }
type Step = { id: string; order: number }
type ConnectionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useConnectionState']>[0]>[0]

const SEAT_CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

function mount({
  wide = true,
  connectionState = 'connected',
  onboardingActive = true,
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  steps = [{ id: 'welcome', order: -100 }, { id: 'credential', order: 0 }],
}: {
  wide?: boolean
  connectionState?: ConnectionSnapshot
  onboardingActive?: boolean
  rows?: Row[]
  steps?: Step[]
} = {}) {
  let current = rows
  let currentConnectionState = connectionState
  const listeners = new Set<() => void>()
  const connectionListeners = new Set<() => void>()
  const reconnect = vi.fn()
  const renderSlotSpy = vi.fn(
    (key: string, _owner: unknown, opts?: { only?: string }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
      return SEAT_CONTENT[key]
    },
  )
  const rootRenderSlot = renderSlotSpy as unknown as SettingsRootComponentProps['renderSlot']
  const pageRenderSlot = renderSlotSpy as unknown as SettingsPageComponentProps['renderSlot']
  const useSessions = ((select: (state: unknown) => unknown) => select(onboardingActive
    ? { phase: 'ready', current: undefined, byId: {} }
    : { phase: 'ready', current: 'active-session', byId: { 'active-session': { blank: false } } })) as never
  const unusedHook = (() => { throw new Error('unused by Settings components') }) as never
  const useConnectionState: SettingsRootComponentProps['useConnectionState'] = (select) => {
    const [, force] = useState(0)
    useEffect(() => {
      const listener = () => { force(n => n + 1) }
      connectionListeners.add(listener)
      return () => { connectionListeners.delete(listener) }
    }, [])
    return select(currentConnectionState)
  }
  const useSections: SettingsPageComponentProps['useSections'] = (select) => {
    const [, force] = useState(0)
    useEffect(() => {
      const listener = () => { force(n => n + 1) }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }, [])
    return select(current)
  }

  function Harness() {
    const [page, setPage] = useState<'conversation' | 'settings'>('conversation')
    const [section, setSection] = useState<string | undefined>()
    const shared = {
      reconnect,
      openSettings: (next?: string) => { setSection(next); setPage('settings') },
      selectSettingsSection: setSection,
      showConversation: () => { setSection(undefined); setPage('conversation') },
      t: makeTranslate(en),
    }
    const rootProps: SettingsRootComponentProps = {
      ...shared,
      renderSlot: rootRenderSlot,
      useSessions,
      useSessionPendingInteraction: unusedHook,
      useWorkspaces: unusedHook,
      wide,
      useConnectionState,
      useOnboardingSteps: select => select(steps),
      useSections,
    }
    const pageProps: SettingsPageComponentProps = {
      ...shared,
      renderSlot: pageRenderSlot,
      section,
      useSessions,
      useSessionPendingInteraction: unusedHook,
      useWorkspaces: unusedHook,
      useConnectionState,
      useOnboardingSteps: select => select(steps),
      useSections,
    }
    return <><SettingsRoot {...rootProps} />{page === 'settings' && <SettingsPage {...pageProps} />}</>
  }

  const view = render(<Harness />)
  const bump = (next: Row[]) => {
    act(() => {
      current = next
      for (const fn of [...listeners]) fn()
    })
  }
  const setConnectionState = (next: typeof currentConnectionState) => {
    act(() => {
      currentConnectionState = next
      for (const fn of [...connectionListeners]) fn()
    })
  }
  return { view, renderSlot: renderSlotSpy, bump, listeners, reconnect, setConnectionState }
}

function openPanel() {
  const trigger = screen.getByRole('button', { name: 'Settings' })
  fireEvent.click(trigger)
}

describe('SettingsRoot trigger', () => {
  it('opens Settings as a main page through the layout command', () => {
    const { renderSlot } = mount()
    const trigger = screen.getByRole('button', { name: 'Settings' })
    expect(trigger.hasAttribute('aria-label')).toBe(false)
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false)
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: true })
    fireEvent.click(trigger)
    expect(screen.getByRole('main', { name: 'Settings Title' })).toBeTruthy()
  })

  it('hands the rail state to the trigger seat', () => {
    const { renderSlot } = mount({ wide: false })
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: false })
  })

  it('shows outage, retry progress, and a two-second recovery confirmation', () => {
    vi.useFakeTimers()
    const mounted = mount()
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()
    mounted.setConnectionState('disconnected')
    const indicator = screen.getByRole('button', { name: 'Disconnected, reconnect now' })
    expect(indicator.textContent).toContain('Disconnected')
    expect(indicator.hasAttribute('title')).toBe(false)
    expect(indicator.querySelector('svg')).toBeTruthy()
    fireEvent.click(indicator)
    expect(mounted.reconnect).toHaveBeenCalledOnce()
    mounted.setConnectionState('connecting')
    expect(screen.getByRole('button', { name: 'Connecting, restart now' }).textContent).toContain('Connecting...')
    mounted.setConnectionState('connected')
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the reconnect indicator out of the collapsed rail', () => {
    mount({ wide: false, connectionState: 'disconnected' })
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()
  })
})

describe('Settings page', () => {
  it('names the page and navigation from the header seat', () => {
    mount()
    openPanel()
    const main = screen.getByRole('main', { name: 'Settings Title' })
    const titleId = main.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)?.textContent).toBe('Settings Title')
    expect(screen.getByRole('navigation', { name: 'Settings Title' })).toBeTruthy()
  })

  it('renders actions and a close button named by its seat', () => {
    const { renderSlot } = mount()
    openPanel()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {})
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(document.activeElement).toBe(close)
  })

  it('closes through the header and Escape without dialog semantics', () => {
    mount()
    openPanel()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('main')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('main')).toBeNull()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('main')).toBeNull()
  })

  it('marks the first row active and switches sections', () => {
    mount()
    openPanel()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('section-general')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(screen.queryByTestId('section-general')).toBeNull()
  })

  it('gives known sections distinct glyphs and unknown sections the gear', () => {
    mount({ rows: [
      { id: 'general', order: 0, label: 'General' },
      { id: 'models', order: 10, label: 'Models' },
      { id: 'agent-presets', order: 20, label: 'Agent presets' },
      { id: 'plugins', order: 30, label: 'Plugins' },
      { id: 'contributed', order: 40, label: 'Contributed' },
    ] })
    openPanel()
    const glyphs = ['General', 'Models', 'Agent presets', 'Plugins', 'Contributed']
      .map(name => screen.getByRole('button', { name }).querySelector('svg')?.innerHTML)
    expect(glyphs.every(glyph => glyph !== undefined && glyph !== '')).toBe(true)
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4)
    expect(glyphs[4]).toBe(glyphs[0])
  })

  it('opens a section requested by onboarding', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    act(() => { (first?.[1] as { complete: () => void }).complete() })
    const second = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding').at(-1)
    act(() => { (second?.[1] as { openSection: (id: string) => void }).openSection('models') })
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByTestId('section-models')).toBeTruthy()
    cleanup()
    const inactive = mount({ onboardingActive: false }).renderSlot.mock.calls
      .filter(call => call[0] === 'settings.onboarding')
    expect(inactive).toHaveLength(0)
  })

  it('falls back when a section unregisters and supports an empty ledger', () => {
    const mounted = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    mounted.bump([{ id: 'general', order: 0, label: 'General' }])
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
    cleanup()
    const empty = mount({ rows: [] })
    openPanel()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(empty.renderSlot.mock.calls.filter(call => String(call[0]) === 'settings.section')).toHaveLength(0)
  })

  it('subscribes to the section ledger only while the page is open', () => {
    const { view, listeners } = mount()
    expect(listeners.size).toBe(0)
    openPanel()
    expect(listeners.size).toBe(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(listeners.size).toBe(0)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})

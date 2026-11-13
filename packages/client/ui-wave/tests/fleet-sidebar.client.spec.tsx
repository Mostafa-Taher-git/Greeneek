// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {} from '../src/client/index.ts'
import { FleetSidebar } from '../src/client/FleetSidebar.tsx'
import { en } from '../src/client/locales.ts'
import {
  emptySnapshot, fleetProps, fleetPropsWithSessions, fleetSource, fleetVerbs, liveSnapshot,
  sessionListWithSettledAgent, sessionListWithoutAgent,
} from './fleet-surface-fixture.client.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup(initial = liveSnapshot()) {
  const source = fleetSource(initial)
  const verbs = fleetVerbs()
  render(<FleetSidebar {...fleetProps(source, verbs)} />)
  return { source, verbs }
}

describe('FleetSidebar (S5-11a dedicated right sidebar)', () => {
  it('auto-opens when agents start running', () => {
    const { source, verbs } = setup(emptySnapshot())
    expect(verbs.openSidebar).not.toHaveBeenCalled()
    act(() => { source.set(liveSnapshot()) })
    expect(verbs.openSidebar).toHaveBeenCalledTimes(1)
  })

  it('does not re-open on every poll while already running', () => {
    const { source, verbs } = setup()
    expect(verbs.openSidebar).toHaveBeenCalledTimes(1)
    act(() => { source.set(liveSnapshot()) })
    expect(verbs.openSidebar).toHaveBeenCalledTimes(1)
  })

  it('keeps the Emergency Stop reachable at the top of the sidebar', async () => {
    const { verbs } = setup()
    expect(screen.getByText(en['fleet.title'])).toBeDefined()
    fireEvent.click(screen.getByText(en['stop.all']))
    expect(verbs.stopAll).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText(en['stop.all.confirm']))
    })
    expect(verbs.stopAll).toHaveBeenCalled()
    expect(screen.getByText(en['stop.stopped'])).toBeDefined()
  })

  it('renders the reused fleet rows inside the sidebar body', () => {
    setup()
    expect(screen.getByText('writer')).toBeDefined()
    expect(screen.getByText('docs pass')).toBeDefined()
  })

  it('shows lineage above Live Fleet and opens an ancestor Session', () => {
    const { verbs } = setup()
    const lineage = screen.getByRole('navigation', { name: en['lineage.aria'] })
    expect(lineage.textContent).toContain('Parent agent')
    expect(lineage.textContent).toContain('Child agent')
    fireEvent.click(screen.getByRole('button', { name: 'Parent agent' }))
    expect(verbs.openSession).toHaveBeenCalledWith('parent-session')
    expect(lineage.compareDocumentPosition(screen.getByText('writer')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the empty sentence when no agent ran under the Session', () => {
    const source = fleetSource(liveSnapshot())
    const verbs = fleetVerbs()
    const props = fleetPropsWithSessions(source, verbs, sessionListWithoutAgent())
    render(<FleetSidebar {...props} />)
    const toggle = screen.getByRole('button', { name: new RegExp(`^${en['lineage.agents.title']}`) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByText(en['lineage.agents.empty'])).toBeTruthy()
    expect(verbs.openChild).not.toHaveBeenCalled()
  })

  it('renders the running chip only for running agents', () => {
    const source = fleetSource(liveSnapshot())
    const verbs = fleetVerbs()
    const props = fleetPropsWithSessions(source, verbs, sessionListWithSettledAgent())
    render(<FleetSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${en['lineage.agents.title']}`) }))
    const group = screen.getByRole('region', { name: en['lineage.agents.title'] })
    expect(group.textContent).toContain('Settled agent')
    expect(group.textContent).not.toContain(en['lineage.agents.running'])
  })

  it('renders the Lineage and Live Fleet section headings', () => {
    setup()
    expect(screen.getByRole('heading', { name: en['lineage.title'], level: 3 })).toBeDefined()
    expect(screen.getByRole('heading', { name: en['fleet.title'], level: 3 })).toBeDefined()
  })

  it('lists the Harness agents that ran under the Session in the Previous agents group', () => {
    const { verbs } = setup()
    const toggle = screen.getByRole('button', { name: new RegExp(`^${en['lineage.agents.title']}`) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const group = screen.getByRole('region', { name: en['lineage.agents.title'] })
    expect(group.textContent).toContain('Harness agent')
    expect(group.textContent).toContain(en['lineage.agents.running'])
    // The agent row opens the member's child transcript.
    fireEvent.click(screen.getByRole('button', { name: /Harness agent/ }))
    expect(verbs.openChild).toHaveBeenCalledWith('harness-agent')
  })
})

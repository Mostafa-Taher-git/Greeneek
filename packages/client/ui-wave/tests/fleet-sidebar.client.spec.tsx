// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {} from '../src/client/index.ts'
import { FleetSidebar } from '../src/client/FleetSidebar.tsx'
import { en } from '../src/client/locales.ts'
import {
  emptySnapshot, fleetProps, fleetSource, fleetVerbs, liveSnapshot,
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

  it('closes in one click from the sidebar header', () => {
    const { verbs } = setup()
    fireEvent.click(screen.getByRole('button', { name: en['sidebar.close.aria'] }))
    expect(verbs.closeSidebar).toHaveBeenCalledTimes(1)
  })

  it('keeps the Emergency Stop reachable at the top of the sidebar', async () => {
    const { verbs } = setup()
    expect(screen.getByText(en['sidebar.title'])).toBeDefined()
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

  it('lists the Harness agents that ran under the Session beside the lineage', () => {
    setup()
    const group = screen.getByRole('region', { name: en['lineage.agents.title'] })
    expect(group.textContent).toContain('Harness agent')
    expect(group.textContent).toContain(en['lineage.agents.running'])
  })
})

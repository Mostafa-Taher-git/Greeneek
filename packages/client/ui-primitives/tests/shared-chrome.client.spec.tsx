// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsSectionHeader, SidebarPrimaryAction, TabBar } from '@greeneek/gnk-client-ui-primitives'

afterEach(cleanup)

describe('TabBar', () => {
  it('marks the active tab and reports the selected id', () => {
    const onSelect = vi.fn()
    render(
      <TabBar
        tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]}
        activeId="one"
        onSelect={onSelect}
      />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false')
    expect(tabs[0]?.className).not.toBe(tabs[1]?.className)
    fireEvent.click(tabs[1] as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('two')
  })
})

describe('SidebarPrimaryAction', () => {
  it('shows the label in the wide form and opens the target', () => {
    const onClick = vi.fn()
    render(<SidebarPrimaryAction wide label="Tasks" icon={<svg data-testid="ic" />} onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Tasks' })
    expect(screen.getByText('Tasks')).toBeDefined()
    expect(screen.getByTestId('ic')).toBeDefined()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps the accessible name while showing only the icon in the rail', () => {
    render(<SidebarPrimaryAction wide={false} label="Tasks" icon={<svg data-testid="ic" />} onClick={() => {}} />)

    expect(screen.getByRole('button', { name: 'Tasks' })).toBeDefined()
    expect(screen.queryByText('Tasks')).toBeNull()
    expect(screen.getByTestId('ic')).toBeDefined()
  })
})

describe('SettingsSectionHeader', () => {
  it('renders the heading, owner actions, intro and close control', () => {
    const onClose = vi.fn()
    render(
      <SettingsSectionHeader
        title="Plugins"
        intro="Manage plugins"
        closeLabel="Close plugins"
        onClose={onClose}
        actionsClassName="owner-actions"
      >
        <button type="button">Refresh</button>
      </SettingsSectionHeader>)

    expect(screen.getByRole('heading', { name: 'Plugins' })).toBeDefined()
    expect(screen.getByText('Manage plugins')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Refresh' }).parentElement?.className).toContain('owner-actions')
    fireEvent.click(screen.getByRole('button', { name: 'Close plugins' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

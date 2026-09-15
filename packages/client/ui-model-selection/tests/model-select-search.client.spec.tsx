// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@greeneek/gnk-api-remotes/client'
import { createSnapshotStore } from '@greeneek/gnk-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'

const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'acme', model: 'flash' },
    routable: true,
    groups: [
      {
        id: 'acme',
        name: 'Acme',
        models: [
          {
            id: 'flash',
            name: 'Acme Flash',
            description: 'Fastest route',
            reasoning: {
              efforts: [
                { id: 'low', name: 'Low' },
                { id: 'medium', name: 'Medium' },
                { id: 'high', name: 'High' },
              ],
              defaultEffort: 'medium',
            },
          },
          {
            id: 'pro',
            name: 'Acme Pro',
            description: 'Deepest reasoning',
            reasoning: { efforts: [{ id: 'high', name: 'High' }] },
          },
        ],
      },
      {
        id: 'other',
        name: 'Other',
        models: [{ id: 'mini', name: 'Other Mini' }],
      },
    ],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function openModelPane(directory = createSnapshotStore(state())): void {
  render(<ModelSelect
    locked={false}
    available
    directory={directory}
    load={vi.fn()}
    select={vi.fn().mockResolvedValue(true)}
    t={t}
  />)
  fireEvent.click(screen.getByRole('button', { name: /Acme Flash/ }))
  // The overview greets first; the Model row drills into the searchable list.
  fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
}

afterEach(cleanup)

describe('ModelSelect model search', () => {
  it('groups rows under provider headers', () => {
    openModelPane()
    expect(screen.getByRole('group', { name: 'Acme' })).toBeDefined()
    expect(screen.getByRole('group', { name: 'Other' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: /Acme Flash/ })).toBeDefined()
  })

  it('narrows rows by name and hides emptied providers', () => {
    openModelPane()
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'pro' } })
    expect(screen.getByRole('menuitemradio', { name: /Acme Pro/ })).toBeDefined()
    expect(screen.queryByRole('menuitemradio', { name: /Acme Flash/ })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: /Other Mini/ })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Other' })).toBeNull()
  })

  it('matches descriptions and provider names', () => {
    openModelPane()
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'deepest' } })
    expect(screen.getByRole('menuitemradio', { name: /Acme Pro/ })).toBeDefined()
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'other' } })
    expect(screen.getByRole('menuitemradio', { name: /Other Mini/ })).toBeDefined()
    expect(screen.queryByRole('menuitemradio', { name: /Acme Pro/ })).toBeNull()
  })

  it('reports no match and keeps the menu open', () => {
    openModelPane()
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的模型，换个关键词试试。')).toBeDefined()
    expect(screen.queryByRole('menuitemradio')).toBeNull()
  })

  it('clears the filter on the first Escape and closes on the second', () => {
    openModelPane()
    const search = screen.getByLabelText('搜索模型')
    fireEvent.change(search, { target: { value: 'pro' } })
    search.focus()
    expect(screen.queryByRole('menuitemradio', { name: /Acme Flash/ })).toBeNull()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.getByRole('menuitemradio', { name: /Acme Flash/ })).toBeDefined()
    fireEvent.keyDown(screen.getByLabelText('搜索模型'), { key: 'Escape' })
    expect(screen.queryByLabelText('搜索模型')).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: /Acme Flash/ })).toBeNull()
  })

  it('jumps from the search box to the first row on ArrowDown', () => {
    openModelPane()
    const search = screen.getByLabelText('搜索模型')
    fireEvent.change(search, { target: { value: 'acme' } })
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio')
    expect(document.activeElement?.textContent).toContain('Acme Flash')
  })

  it('resets the filter when the menu reopens', () => {
    const directory = createSnapshotStore(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /Acme Flash/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const search = screen.getByLabelText('搜索模型')
    fireEvent.change(search, { target: { value: 'pro' } })
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: /Acme Pro/ }), { key: 'Escape' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.getByDisplayValue('')).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: /Acme Flash/ })).toBeDefined()
  })

  it('selects through the filter and keeps the panel open', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Flash/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'mini' } })
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Other Mini/ }))
    expect(select).toHaveBeenCalledWith({ provider: 'other', model: 'mini' })
    // Model selection no longer dismisses the menu; the filtered row remains visible.
    expect(screen.getByRole('menuitemradio', { name: /Other Mini/ })).toBeDefined()
  })

  it('shows no sidecar: rows carry names only', () => {
    openModelPane()
    expect(screen.queryByLabelText('模型详情')).toBeNull()
    expect(screen.queryByText('Fastest route')).toBeNull()
    expect(screen.queryByText('Deepest reasoning')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /Acme Flash/ })).toBeDefined()
  })

  it('switches provider from the model list and keeps browsing', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Flash/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Acme Pro/ }))
    expect(select).toHaveBeenCalledWith({ provider: 'acme', model: 'pro' })
    // Model selection keeps the menu open so the user can keep browsing.
    await waitFor(() => {
      expect(screen.getByRole('menuitemradio', { name: /Acme Pro/ })).toBeDefined()
    })
  })

  it('the effort entry follows the newly picked provider model', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)
    // Other Mini declares no levels: after picking it, the Effort entry
    // disables with a note — the slider always shows the live provider
    // model's real levels, never a stale vocabulary.
    fireEvent.click(screen.getByRole('button', { name: /Acme Flash/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Other Mini/ }))
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
    const chip = screen.getByRole('button', { name: '推理等级' })
    expect(chip.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('当前模型未提供推理等级。')).toBeDefined()
  })
})

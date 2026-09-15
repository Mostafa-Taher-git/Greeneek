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

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  // Deliberately unordered: the list sorts the power scale itself, and
  // `off`/`minimal` sit outside the scale so they are never rows.
  efforts: [
    { id: 'max', name: 'Max', description: 'Largest budget' },
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low' },
    { id: 'minimal', name: 'Minimal' },
    { id: 'xhigh', name: 'Extra High' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'greeneek-official', model: 'greeneek-v4-flash' },
    routable: true,
    groups: [{
      id: 'greeneek-official',
      name: 'Greeneek',
      models: [{
        id: 'greeneek-v4-flash',
        name: 'Greeneek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('offers the real levels on a stepped slider and submits the effort as part of the session selection', async () => {
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

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 Greeneek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    // The overview pairs the Model row with the Effort entry: no Speed, no
    // duplicate Effort row, and the list stays behind the Model row.
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeDefined()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText('Speed')).toBeNull()
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')

    fireEvent.click(screen.getByRole('button', { name: '推理等级 · High' }))
    const slider = screen.getByRole('slider', { name: '推理等级' })
    // The adapter configures a model default, so the 7 declared levels are
    // the stops — nothing hidden, nothing re-ranked. Descriptions never render.
    expect(slider.getAttribute('aria-valuemax')).toBe('6')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    for (const absent of ['Largest budget', 'Default']) {
      expect(screen.queryByText(absent)).toBeNull()
    }

    fireEvent.keyDown(slider, { key: 'Home' })
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'greeneek-official',
        model: 'greeneek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 Greeneek-V4-Flash，推理等级 Max')
    })
    // Effort selection keeps the menu open like model selection; the slider
    // follows the new level and a re-pick commits nothing.
    expect(screen.getByRole('slider', { name: '推理等级' }).getAttribute('aria-valuetext')).toBe('Max')
    fireEvent.keyDown(screen.getByRole('slider', { name: '推理等级' }), { key: 'Home' })
    expect(select).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('slider', { name: '推理等级' })).toBeDefined()
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    const selectWithDefault = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={selectWithDefault}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('button', { name: '推理等级 · Default' }))
    // The slider opens on Default with Standard as the only other stop.
    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(slider.getAttribute('aria-valuemax')).toBe('1')
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    expect(slider.getAttribute('aria-valuetext')).toBe('Default')
    // Default names the trigger caption; every offered level names its stop.
    expect(screen.getAllByText('Default')).toHaveLength(3)
    expect(screen.getByText('Standard')).toBeTruthy()
    fireEvent.keyDown(slider, { key: 'End' })
    expect(selectWithDefault).toHaveBeenCalledWith({
      provider: 'provider',
      model: 'model',
      reasoningEffort: 'standard',
    })
  })

  it('offers every declared level verbatim, in declaration order', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'greeneek-official',
        name: 'Greeneek',
        models: [{
          id: 'greeneek-v4-flash',
          name: 'Greeneek-V4-Flash',
          description: 'Fast catalog description',
          reasoning: {
            efforts: [
              { id: 'max', name: 'Max' },
              { id: 'ultra', name: 'Ultra' },
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'minimal', name: 'Minimal' },
              { id: 'standard', name: 'Standard' },
              { id: 'medium', name: 'Medium' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'medium',
          },
        }],
      }],
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Greeneek-V4-Flash，推理等级 Medium',
    }))
    fireEvent.click(screen.getByRole('button', { name: '推理等级 · Medium' }))
    // Eight declared levels, model default Medium: eight stops, first stop
    // Max and last stop High name the endpoint captions.
    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(slider.getAttribute('aria-valuemax')).toBe('7')
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium')
    expect(screen.getByText('Max')).toBeDefined()
    expect(screen.getByText('High')).toBeDefined()
  })

  it('shows the durable model id when the catalog has no matching display name', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'greeneek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型，当前 greeneek-official/removed-model' })
    expect(trigger.textContent).toContain('greeneek-official/removed-model')
    fireEvent.click(trigger)
    // The overview greets first: no list rows until the Model row drills in.
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /Greeneek-V4-Flash/ })).toBeTruthy()
    // Rows carry names only: with no sidecar, the catalog description
    // renders nowhere (search still matches it).
    expect(screen.queryByText('Fast catalog description')).toBeNull()
  })

  it('shows loading until the catalog and Session projection are both ready', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: null,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    expect(screen.getByRole('button', { name: '正在加载模型…' }).textContent)
      .toContain('正在加载模型…')
    directory.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 Greeneek-V4-Flash，推理等级 High',
      })).toBeTruthy()
    })
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'greeneek-official',
      name: 'Greeneek',
      models: [
        { id: 'greeneek-v4-flash', name: 'Greeneek-V4-Flash', reasoning },
        { id: 'greeneek-v4-pro', name: 'Greeneek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'session/model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Greeneek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：session/model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('drills from the overview into each pane, backs out, and resets on reopen', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 Greeneek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeDefined()
    expect(screen.queryByLabelText('搜索模型')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('搜索模型')
    expect(screen.getByRole('menuitemradio', { name: /Greeneek-V4-Flash/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeDefined()
    expect(screen.queryByLabelText('搜索模型')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '推理等级 · High' }))
    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(document.activeElement).toBe(slider)
    fireEvent.click(screen.getByRole('button', { name: '推理等级' }))
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeDefined()

    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.keyDown(screen.getByLabelText('搜索模型'), { key: 'Escape' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeDefined()
    expect(screen.queryByLabelText('搜索模型')).toBeNull()
  })

  it('disables the Effort entry with a note when the model declares no levels', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: [{
        id: 'plain',
        name: 'Plain',
        models: [{ id: 'basic', name: 'Basic' }],
      }],
      current: { provider: 'plain', model: 'basic' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: '选择模型，当前 Basic' }))
    const chip = screen.getByRole('button', { name: '推理等级' })
    expect(chip.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('当前模型未提供推理等级。')).toBeDefined()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('keeps the slider inert while a selection is in flight', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Greeneek-V4-Flash，推理等级 High',
    }))
    fireEvent.click(screen.getByRole('button', { name: '推理等级 · High' }))
    directory.set(state({ status: 'selecting' }))
    const busySlider = await screen.findByRole('slider', { name: '推理等级' })
    expect(busySlider.getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(busySlider, { key: 'ArrowRight' })
    expect(screen.getByRole('slider', { name: '推理等级' })).toBeDefined()
  })

  it('names the effort loss when the catalog drops levels mid-pane', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Greeneek-V4-Flash，推理等级 High',
    }))
    fireEvent.click(screen.getByRole('button', { name: '推理等级 · High' }))
    expect(screen.getByRole('slider', { name: '推理等级' })).toBeDefined()
    directory.set(state({
      groups: [{
        id: 'greeneek-official',
        name: 'Greeneek',
        models: [{ id: 'greeneek-v4-flash', name: 'Greeneek-V4-Flash' }],
      }],
    }))
    await waitFor(() => {
      expect(screen.queryByRole('slider')).toBeNull()
    })
    expect(screen.getByText('当前模型未提供推理等级。')).toBeDefined()
  })
})

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
  // Deliberately unordered: the slider sorts the power scale itself, and
  // `off`/`minimal` sit outside the scale so they are never stops.
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
  it('renders effort names without descriptions and submits the effort as part of the session selection', async () => {
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
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(slider.getAttribute('min')).toBe('0')
    expect(slider.getAttribute('max')).toBe('4')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    // Five stops in canonical order however the model declares them: High
    // sits at index 2 and Max at index 4, so Low/Medium/High/Extra High/Max
    // is the only order that fits. Stops render as track dots with no text
    // of their own — the readout names the active stop — and `off`/`minimal`
    // are not offered.
    for (const absent of ['Low', 'Medium', 'Extra High', 'Max', 'Off', 'Minimal', 'Largest budget']) {
      expect(screen.queryByText(absent)).toBeNull()
    }
    // The fill tracks the thumb: High is stop 2 of 4.
    expect(slider.style.getPropertyValue('--fill')).toBe('50%')
    // One dot per stop rides the track at i/(N-1) across the thumb travel;
    // dots at or behind the thumb read filled, dots ahead read empty.
    const menuEl = screen.getByRole('menu')
    const dots = menuEl.querySelectorAll('[data-dot]')
    expect(dots.length).toBe(5)
    expect(dots[0]?.getAttribute('style')).toContain('0 * (100% - 16px)')
    expect(dots[4]?.getAttribute('style')).toContain('1 * (100% - 16px)')
    expect(menuEl.querySelectorAll('[data-dot][data-filled="true"]').length).toBe(3)

    fireEvent.change(slider, { target: { value: '4' } })
    // Hold-and-drag continuity: an in-flight selection never disables the thumb.
    expect(slider.hasAttribute('disabled')).toBe(false)
    // At Max the track is fully charged.
    expect(screen.getByRole('slider', { name: '推理等级' }).style.getPropertyValue('--fill')).toBe('100%')
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'greeneek-official',
        model: 'greeneek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 Greeneek-V4-Flash，推理等级 Max')
    })
    // The slider applies live and stays open for further adjustment.
    expect(screen.getByRole('slider', { name: '推理等级' })).toBeTruthy()
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
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    // Provider default is the first stop when the adapter configures no default.
    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(slider.getAttribute('min')).toBe('0')
    expect(slider.getAttribute('max')).toBe('1')
    expect(slider.getAttribute('aria-valuetext')).toBe('Default')
    // Default names the trigger caption and the slider readout; the Standard
    // stop itself is a track dot with no text.
    expect(screen.getAllByText('Default')).toHaveLength(2)
    expect(screen.queryByText('Standard')).toBeNull()
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
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Greeneek-V4-Flash' })).toBeTruthy()
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
})

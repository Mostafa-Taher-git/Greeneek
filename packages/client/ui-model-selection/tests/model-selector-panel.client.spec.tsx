// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSelectorPanel } from '../src/client/ModelSelectorPanel.tsx'
import { directoryPreviewModels, type PreviewModel } from '../src/client/preview.ts'
import { en } from '../src/client/locales.ts'

const t = (key: keyof typeof en): string => en[key]

const MODELS: PreviewModel[] = [
  {
    value: 'anthropic/claude-fable-5',
    label: 'Claude Fable 5',
    provider: 'Anthropic',
    description: 'Frontier model with Opus fallback.',
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
    ],
    defaultEffort: 'medium',
    metrics: { intelligence: 10, speed: 5, context: 10, cost: 10 },
    contextHint: '1M tokens context window',
    costHint: '$12.50 input · $50.00 output',
  },
  {
    value: 'openai/gpt-5.5',
    label: 'GPT-5.5',
    provider: 'OpenAI',
    description: 'Strongest reasoning configuration.',
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'high', name: 'High' },
    ],
  },
]

afterEach(cleanup)

describe('ModelSelectorPanel', () => {
  it('selects the first model and shows its detail', () => {
    render(<ModelSelectorPanel models={MODELS} t={t} />)
    expect(screen.getByRole('option', { name: /Claude Fable 5/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Frontier model with Opus fallback.')).toBeDefined()
  })

  it('filters rows by search and reports no match', () => {
    render(<ModelSelectorPanel models={MODELS} t={t} />)
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'gpt' } })
    expect(screen.queryByRole('option', { name: /Claude/ })).toBeNull()
    expect(screen.getByRole('option', { name: /GPT-5.5/ })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matching models — try a different search.')).toBeDefined()
  })

  it('reports an empty catalog', () => {
    render(<ModelSelectorPanel models={[]} t={t} />)
    expect(screen.getByText('No models available.')).toBeDefined()
  })

  it('picks a row and announces the change', () => {
    const onModelChange = vi.fn()
    render(<ModelSelectorPanel models={MODELS} onModelChange={onModelChange} t={t} />)
    fireEvent.click(screen.getByRole('option', { name: /GPT-5.5/ }))
    expect(onModelChange).toHaveBeenCalledWith(MODELS[1])
    expect(screen.getByText('Strongest reasoning configuration.')).toBeDefined()
  })

  it('moves selection with arrow keys', () => {
    render(<ModelSelectorPanel models={MODELS} t={t} />)
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /GPT-5.5/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /Claude Fable 5/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('configures a reasoning effort and badges the row', () => {
    const onConfigurationChange = vi.fn()
    render(<ModelSelectorPanel models={MODELS} onConfigurationChange={onConfigurationChange} t={t} />)
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    expect(onConfigurationChange).toHaveBeenCalledWith(
      'anthropic/claude-fable-5', 'high', { 'anthropic/claude-fable-5': 'high' })
    expect(screen.getByText('High', { selector: 'span' })).toBeDefined()
  })

  it('offers a Default row when the provider sets no default', () => {
    render(<ModelSelectorPanel models={MODELS} value="openai/gpt-5.5" t={t} />)
    expect(screen.getByRole('radio', { name: 'Default' })).toBeDefined()
  })

  it('renders metric bars only for models that provide them', () => {
    render(<ModelSelectorPanel models={MODELS} t={t} />)
    expect(screen.getByRole('img', { name: 'Intelligence: 10 out of 10' })).toBeDefined()
    expect(screen.getByRole('img', { name: 'Cost: 10 out of 10' })).toBeDefined()
    fireEvent.click(screen.getByRole('option', { name: /GPT-5.5/ }))
    expect(screen.queryByRole('img', { name: /out of 10/ })).toBeNull()
  })

  it('submits the selected model, effort, and prompt', () => {
    const onSubmit = vi.fn()
    render(<ModelSelectorPanel models={MODELS} onSubmit={onSubmit} t={t} />)
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith({
      model: MODELS[0], effort: 'high', prompt: 'hello',
    })
  })

  it('submits the provider default when nothing is configured', () => {
    const onSubmit = vi.fn()
    render(<ModelSelectorPanel models={MODELS} onSubmit={onSubmit} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith({
      model: MODELS[0], effort: 'medium', prompt: '',
    })
  })

  it('hides the prompt footer on request', () => {
    render(<ModelSelectorPanel models={MODELS} showPrompt={false} t={t} />)
    expect(screen.queryByLabelText('Prompt')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('disables rows and send together', () => {
    render(<ModelSelectorPanel disabled models={MODELS} t={t} />)
    expect(screen.getByRole('option', { name: /Claude/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('directoryPreviewModels', () => {
  it('flattens groups with opaque row ids and real efforts', () => {
    const rows = directoryPreviewModels([{
      id: 'greeneek-official',
      name: 'Greeneek',
      models: [{
        id: 'greeneek-v4-flash',
        name: 'Greeneek-V4-Flash',
        description: 'Fast catalog description',
        reasoning: {
          efforts: [{ id: 'high', name: 'High' }],
          defaultEffort: 'high',
        },
      }],
    }])
    expect(rows).toEqual([{
      value: 'greeneek-official/greeneek-v4-flash',
      label: 'Greeneek-V4-Flash',
      provider: 'Greeneek',
      description: 'Fast catalog description',
      efforts: [{ id: 'high', name: 'High' }],
      defaultEffort: 'high',
    }])
  })

  it('leaves models without reasoning unconfigured', () => {
    const rows = directoryPreviewModels([{
      id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }],
    }])
    expect(rows[0]?.efforts).toEqual([])
    expect(rows[0]?.defaultEffort).toBeUndefined()
  })

  it('passes every declared level through verbatim', () => {
    const rows = directoryPreviewModels([{
      id: 'p',
      name: 'P',
      models: [{
        id: 'm',
        name: 'M',
        reasoning: {
          efforts: [
            { id: 'max', name: 'Max' },
            { id: 'ultra', name: 'Ultra' },
            { id: 'off', name: 'Off' },
            { id: 'standard', name: 'Standard' },
            { id: 'low', name: 'Low' },
          ],
          defaultEffort: 'low',
        },
      }],
    }])
    expect(rows[0]?.efforts).toEqual([
      { id: 'max', name: 'Max' },
      { id: 'ultra', name: 'Ultra' },
      { id: 'off', name: 'Off' },
      { id: 'standard', name: 'Standard' },
      { id: 'low', name: 'Low' },
    ])
  })
})

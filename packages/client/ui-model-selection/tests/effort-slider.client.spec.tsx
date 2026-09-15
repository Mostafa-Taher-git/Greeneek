// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffortSlider, type EffortChoice } from '../src/client/EffortSlider.tsx'

const choices: EffortChoice[] = [
  { key: 'provider-default', effort: undefined, label: 'Default' },
  { key: 'effort:low', effort: 'low', label: 'Low' },
  { key: 'effort:high', effort: 'high', label: 'High' },
]

function renderSlider(props: Partial<Parameters<typeof EffortSlider>[0]> = {}) {
  const onCommit = vi.fn()
  render(<EffortSlider
    choices={choices}
    index={1}
    disabled={false}
    label="Reasoning effort"
    onCommit={onCommit}
    {...props}
  />)
  return { onCommit, slider: screen.getByRole('slider', { name: 'Reasoning effort' }) }
}

/** jsdom reports zero geometry; pointer tests pin a track rectangle. */
function pinRect(element: HTMLElement, left = 0, width = 200): void {
  element.getBoundingClientRect = () => ({
    left, width, top: 0, height: 28, right: left + width, bottom: 28,
    x: left, y: 0, toJSON: () => ({}),
  })
}

afterEach(cleanup)

describe('EffortSlider', () => {
  it('names the current stop and its endpoints under their real names', () => {
    const { slider } = renderSlider()
    expect(slider.getAttribute('aria-valuemin')).toBe('0')
    expect(slider.getAttribute('aria-valuemax')).toBe('2')
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
    expect(slider.getAttribute('aria-valuetext')).toBe('Low')
    expect(screen.getByText('Default')).toBeDefined()
    expect(screen.getByText('High')).toBeDefined()
  })

  it('commits the neighbor stop on arrow keys and the ends on Home/End', () => {
    const { onCommit, slider } = renderSlider()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onCommit).toHaveBeenCalledWith('high')
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onCommit).toHaveBeenCalledWith(undefined)
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(onCommit).toHaveBeenCalledWith('high')
    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(onCommit).toHaveBeenCalledWith(undefined)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onCommit).toHaveBeenCalledWith(undefined)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(onCommit).toHaveBeenCalledWith('high')
    expect(onCommit).toHaveBeenCalledTimes(6)
  })

  it('ignores unrelated keys and a keypress landing on the current stop', () => {
    const { onCommit, slider } = renderSlider({ index: 2 })
    fireEvent.keyDown(slider, { key: 'a' })
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2')
  })

  it('ignores keys while disabled', () => {
    const { onCommit, slider } = renderSlider({ disabled: true })
    expect(slider.getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('previews the drag without committing until release', () => {
    const { onCommit, slider } = renderSlider()
    pinRect(slider)
    fireEvent.pointerDown(slider, { clientX: 190 })
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerMove(slider, { clientX: 10 })
    expect(slider.getAttribute('aria-valuetext')).toBe('Default')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { clientX: 10 })
    expect(onCommit).toHaveBeenCalledWith(undefined)
  })

  it('drops the preview on cancel and ignores stray moves', () => {
    const { onCommit, slider } = renderSlider()
    pinRect(slider)
    fireEvent.pointerMove(slider, { clientX: 190 })
    fireEvent.pointerUp(slider, { clientX: 190 })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerDown(slider, { clientX: 190 })
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    fireEvent.pointerCancel(slider)
    expect(slider.getAttribute('aria-valuetext')).toBe('Low')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('tolerates lost geometry mid-gesture', () => {
    const { onCommit, slider } = renderSlider()
    pinRect(slider)
    fireEvent.pointerDown(slider, { clientX: 190 })
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    // The layout box goes away mid-drag: moves preview nothing, and the
    // release falls back to the last known drag fraction.
    delete (slider as unknown as Record<string, unknown>).getBoundingClientRect
    fireEvent.pointerMove(slider, { clientX: 10 })
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { clientX: 10 })
    expect(onCommit).toHaveBeenCalledWith('high')
  })

  it('ignores the pointer while disabled and without geometry', () => {
    const { onCommit, slider } = renderSlider({ disabled: true })
    pinRect(slider)
    fireEvent.pointerDown(slider, { clientX: 190 })
    fireEvent.pointerUp(slider, { clientX: 190 })
    expect(onCommit).not.toHaveBeenCalled()
    cleanup()
    const fresh = renderSlider()
    fireEvent.pointerDown(fresh.slider, { clientX: 190 })
    expect(fresh.slider.getAttribute('aria-valuetext')).toBe('Low')
    expect(fresh.onCommit).not.toHaveBeenCalled()
  })

  it('renders a single stop full with no captions and no commit', () => {
    const onCommit = vi.fn()
    render(<EffortSlider
      choices={[{ key: 'effort:high', effort: 'high', label: 'High' }]}
      index={0}
      disabled={false}
      label="Reasoning effort"
      onCommit={onCommit}
    />)
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' })
    expect(slider.getAttribute('aria-valuemax')).toBe('0')
    expect(screen.queryByText('High')).toBeDefined()
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('renders nothing committable without choices', () => {
    const onCommit = vi.fn()
    render(<EffortSlider
      choices={[]}
      index={0}
      disabled={false}
      label="Reasoning effort"
      onCommit={onCommit}
    />)
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' })
    expect(slider.getAttribute('aria-valuemax')).toBe('0')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onCommit).not.toHaveBeenCalled()
  })
})

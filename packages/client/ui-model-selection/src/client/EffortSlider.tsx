import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import css from './ModelSelect.module.css'

/** One dynamic effort stop; undefined means preserve the provider default. */
export interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/**
 * The Effort pane's stepped slider: one stop per real level of the current
 * model (Default first when the adapter configures no model default), knob
 * and fill positioned by stop fraction, commit on release or keypress —
 * never mid-drag. No canvas, no springs: position rides CSS, and reduced
 * motion kills the remaining transition. Geometry reads the event's own
 * target, so no measuring ref can dangle.
 */
export function EffortSlider({ choices, index, disabled, label, onCommit }: {
  choices: EffortChoice[]
  index: number
  disabled: boolean
  label: string
  onCommit: (effort: string | undefined) => void
}): React.JSX.Element {
  const [drag, setDrag] = useState<number | null>(null)
  const count = choices.length
  const preview = drag === null
    ? Math.min(count - 1, Math.max(0, index))
    : Math.min(count - 1, Math.max(0, Math.round(drag * (count - 1))))
  const fraction = count <= 1 ? 1 : preview / (count - 1)

  const fractionFromClientX = (clientX: number, target: HTMLDivElement): number | null => {
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0) return null
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const commitAt = (target: number): void => {
    const clamped = Math.min(count - 1, Math.max(0, target))
    const choice = choices[clamped]
    if (choice === undefined || clamped === index) return
    onCommit(choice.effort)
  }

  const onSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -1
        : event.key === 'Home'
          ? -index
          : event.key === 'End'
            ? count - 1 - index
            : null
    if (step === null) return
    event.preventDefault()
    event.stopPropagation()
    commitAt(index + step)
  }

  const onSliderPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    const pos = fractionFromClientX(event.clientX, event.currentTarget)
    if (pos !== null) setDrag(pos)
  }

  const onSliderPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || drag === null) return
    const pos = fractionFromClientX(event.clientX, event.currentTarget)
    if (pos !== null) setDrag(pos)
  }

  const onSliderPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || drag === null) return
    const pos = fractionFromClientX(event.clientX, event.currentTarget) ?? drag
    setDrag(null)
    commitAt(Math.round(pos * (count - 1)))
  }

  return (
    <>
      <div className={css.sliderValue} aria-hidden="true">{choices[preview]?.label}</div>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={preview}
        aria-valuetext={choices[preview]?.label}
        aria-disabled={disabled || undefined}
        className={css.slider}
        onKeyDown={onSliderKeyDown}
        onPointerDown={onSliderPointerDown}
        onPointerMove={onSliderPointerMove}
        onPointerUp={onSliderPointerUp}
        onPointerCancel={() => { setDrag(null) }}
      >
        <div className={css.sliderTrack}>
          <div className={css.sliderTicks} aria-hidden="true">
            {choices.map((choice, stop) => (
              <span
                key={choice.key}
                className={css.sliderTick}
                style={{ left: `${count <= 1 ? 100 : (stop / (count - 1)) * 100}%` }}
              />
            ))}
          </div>
          <div className={css.sliderFill} style={{ width: `${fraction * 100}%` }} />
        </div>
        <div className={css.sliderKnob} style={{ left: `${fraction * 100}%` }} />
      </div>
      {count > 1 && choices[0] !== undefined && choices[count - 1] !== undefined && (
        <div className={css.sliderCaptions} aria-hidden="true">
          <span className={css.sliderCaption}>{choices[0].label}</span>
          <span className={css.sliderCaption}>{choices[count - 1]?.label}</span>
        </div>
      )}
    </>
  )
}

/**
 * ModelSelectorPanel: a props-driven model picker with a live detail panel —
 * the Greeneek-native port of the pasted model-selector kit piece. Search
 * filters the rows; selecting a row shows its description, optional metric
 * bars, and its real reasoning levels (from the Host catalog, never a
 * client-owned vocabulary); an optional prompt footer submits
 * `{ model, effort, prompt }`. Feed it with `directoryPreviewModels` for
 * live data. Styling is CSS Modules over the dsw tokens — no Tailwind, no
 * new runtime dependencies (client bundles resolve bare imports from a
 * frozen module table, so base-ui / phosphor could not load at runtime).
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconBrainCircuit16, IconCheckOutline16, IconSearchOutline16, IconSendOutline14,
} from '@greeneek/gnk-client-ui-primitives'
import { en, type ModelKey } from './locales.ts'
import type { PreviewModel } from './preview.ts'
import css from './ModelSelectorPanel.module.css'

/** Translate lookup; defaults to the en preview keys. */
export type PreviewT = (key: ModelKey, params?: Record<string, string>) => string

const defaultT: PreviewT = (key, params) => {
  const template: string = en[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** What the Send footer hands the owner. */
export interface ModelSelectorSubmitPayload {
  readonly model: PreviewModel
  /** Chosen effort id; undefined means the provider default. */
  readonly effort: string | undefined
  readonly prompt: string
}

export interface ModelSelectorPanelProps {
  readonly models?: readonly PreviewModel[]
  readonly value?: string | undefined
  readonly defaultValue?: string | undefined
  readonly onModelChange?: (model: PreviewModel) => void
  /** Configured effort per model value; absent entries read the default. */
  readonly configurations?: Record<string, string | undefined> | undefined
  readonly defaultConfigurations?: Record<string, string | undefined> | undefined
  readonly onConfigurationChange?: (
    modelValue: string,
    effort: string | undefined,
    configurations: Record<string, string | undefined>,
  ) => void
  readonly prompt?: string | undefined
  readonly defaultPrompt?: string | undefined
  readonly onPromptChange?: (prompt: string) => void
  readonly onSubmit?: (payload: ModelSelectorSubmitPayload) => void | Promise<void>
  readonly showPrompt?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly t?: PreviewT | undefined
}

/** Radix -9 scale colors by score; invert so low cost reads good/green. */
function metricColor(value: number, invert: boolean): string {
  const score = invert ? 11 - value : value
  if (score >= 8) return '#30a46c'
  if (score >= 6) return '#46a758'
  if (score >= 4) return '#f76b15'
  return '#e5484d'
}

function MetricBar({ label, value, hint, invert = false }: {
  label: string
  value: number
  hint?: string | undefined
  invert?: boolean | undefined
}) {
  const color = metricColor(value, invert)
  return (
    <div className={css.metric}>
      <div className={css.metricHead}>
        <span className={css.metricLabel}>{label}</span>
        {hint !== undefined && <span className={css.metricHint} title={hint}>ⓘ</span>}
      </div>
      <div aria-label={`${label}: ${value} out of 10`} className={css.metricBar} role="img">
        {Array.from({ length: 10 }, (_, index) => (
          <div className={css.segment} key={index}>
            {index < value && <div className={css.segmentFilled} style={{ backgroundColor: color }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Render the searchable picker with its detail panel and prompt footer.
 * @param props - models, controlled/uncontrolled selection + effort config +
 * prompt seats, submit, and locale.
 * @returns the panel; the detail side tracks the selected row.
 */
export function ModelSelectorPanel({
  models = [],
  value, defaultValue,
  onModelChange,
  configurations, defaultConfigurations = {},
  onConfigurationChange,
  prompt, defaultPrompt = '',
  onPromptChange,
  onSubmit,
  showPrompt = true,
  disabled = false,
  t = defaultT,
}: ModelSelectorPanelProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? models[0]?.value ?? '',
  )
  const [uncontrolledConfigs, setUncontrolledConfigs] = useState(defaultConfigurations)
  const [uncontrolledPrompt, setUncontrolledPrompt] = useState(defaultPrompt)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const selectedValue = value ?? uncontrolledValue
  const selected = models.find(model => model.value === selectedValue) ?? models[0]
  const configs = configurations ?? uncontrolledConfigs
  const promptValue = prompt ?? uncontrolledPrompt

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return models
    return models.filter(model =>
      model.label.toLowerCase().includes(needle)
      || model.provider.toLowerCase().includes(needle)
      || (model.description ?? '').toLowerCase().includes(needle))
  }, [models, query])

  function pick(model: PreviewModel): void {
    if (value === undefined) setUncontrolledValue(model.value)
    onModelChange?.(model)
  }

  function configure(modelValue: string, effort: string | undefined): void {
    const next = { ...configs, [modelValue]: effort }
    if (configurations === undefined) setUncontrolledConfigs(next)
    onConfigurationChange?.(modelValue, effort, next)
  }

  function updatePrompt(next: string): void {
    if (prompt === undefined) setUncontrolledPrompt(next)
    onPromptChange?.(next)
  }

  function handleSubmit(): void {
    if (selected === undefined) return
    const effort = configs[selected.value] ?? selected.defaultEffort
    void onSubmit?.({ model: selected, effort, prompt: promptValue })
  }

  function handleListKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (filtered.length === 0) return
    const current = filtered.findIndex(model => model.value === selected?.value)
    let next = current
    if (event.key === 'ArrowDown') next = Math.min(filtered.length - 1, current + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = filtered.length - 1
    else return
    event.preventDefault()
    const target = filtered[next]
    if (target !== undefined) {
      pick(target)
      rowRefs.current[next]?.focus()
    }
  }

  const searchId = `${id}-search`
  const listId = `${id}-list`

  return (
    <div className={css.root}>
      <div className={css.columns}>
        <div className={css.listPane}>
          <div className={css.search}>
            <IconSearchOutline16 className={css.searchIcon} />
            <input
              aria-label={t('panel.searchAria')}
              className={css.searchInput}
              disabled={disabled}
              id={searchId}
              onChange={(event) => { setQuery(event.target.value) }}
              placeholder={t('panel.searchPlaceholder')}
              type="search"
              value={query}
            />
          </div>
          {models.length === 0 ? (
            <p className={css.empty}>{t('empty.models')}</p>
          ) : filtered.length === 0 ? (
            <p className={css.empty}>{t('panel.emptySearch')}</p>
          ) : (
            <div
              aria-label={t('panel.listAria')}
              className={css.list}
              id={listId}
              onKeyDown={handleListKey}
              ref={listRef}
              role="listbox"
            >
              {filtered.map((model, index) => {
                const active = model.value === selected?.value
                const effort = configs[model.value] ?? model.defaultEffort
                const customized = effort !== undefined
                  && model.defaultEffort !== undefined
                  && effort !== model.defaultEffort
                return (
                  <button
                    aria-selected={active}
                    className={clsx(css.row, active && css.rowSelected)}
                    data-row={model.value}
                    disabled={disabled}
                    key={model.value}
                    onClick={() => { pick(model) }}
                    ref={(node) => { rowRefs.current[index] = node }}
                    role="option"
                    type="button"
                  >
                    <span className={css.rowMain}>
                      <span className={css.rowLabel}>{model.label}</span>
                      <span className={css.rowProvider}>{model.provider}</span>
                    </span>
                    {customized && (
                      <span className={css.badge}>
                        <IconBrainCircuit16 size={11} />
                        {model.efforts.find(level => level.id === effort)?.name ?? effort}
                      </span>
                    )}
                    {active && <IconCheckOutline16 className={css.rowCheck} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {selected !== undefined && (
          <div aria-label={t('panel.detailAria')} className={css.detail}>
            <p className={css.detailTitle}>{selected.label}</p>
            <p className={css.detailProvider}>{selected.provider}</p>
            {selected.description !== undefined && (
              <p className={css.detailDescription}>{selected.description}</p>
            )}
            {selected.metrics !== undefined && (
              <div className={css.metrics}>
                <MetricBar label={t('metric.intelligence')} value={selected.metrics.intelligence} />
                <MetricBar label={t('metric.speed')} value={selected.metrics.speed} />
                <MetricBar
                  hint={selected.contextHint}
                  label={t('metric.context')}
                  value={selected.metrics.context}
                />
                <MetricBar
                  hint={selected.costHint}
                  invert
                  label={t('metric.cost')}
                  value={selected.metrics.cost}
                />
              </div>
            )}
            {selected.efforts.length > 0 && (
              <div className={css.configSection}>
                <p className={css.configTitle}>{t('panel.reasoning')}</p>
                <div aria-label={t('panel.reasoning')} className={css.segmented} role="radiogroup">
                  {selected.defaultEffort === undefined && (
                    <button
                      aria-checked={(configs[selected.value] ?? undefined) === undefined}
                      className={clsx(
                        css.segmentButton,
                        (configs[selected.value] ?? undefined) === undefined && css.segmentButtonChecked,
                      )}
                      disabled={disabled}
                      key="__default"
                      onClick={() => { configure(selected.value, undefined) }}
                      role="radio"
                      type="button"
                    >
                      {t('effort.providerDefault')}
                    </button>
                  )}
                  {selected.efforts.map((level) => {
                    const checked = (configs[selected.value] ?? selected.defaultEffort) === level.id
                    return (
                      <button
                        aria-checked={checked}
                        className={clsx(css.segmentButton, checked && css.segmentButtonChecked)}
                        disabled={disabled}
                        key={level.id}
                        onClick={() => { configure(selected.value, level.id) }}
                        role="radio"
                        type="button"
                      >
                        {level.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {showPrompt && (
        <div className={css.footer}>
          <textarea
            aria-label={t('panel.promptAria')}
            className={css.textarea}
            disabled={disabled || selected === undefined}
            onChange={(event) => { updatePrompt(event.target.value) }}
            placeholder={t('panel.promptPlaceholder')}
            value={promptValue}
          />
          <Button
            disabled={disabled || selected === undefined}
            icon={<IconSendOutline14 />}
            onClick={handleSubmit}
            size="sm"
            variant="primary"
          >
            {t('panel.send')}
          </Button>
        </div>
      )}
    </div>
  )
}

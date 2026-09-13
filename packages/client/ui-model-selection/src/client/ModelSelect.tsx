/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list. The Model pane pairs the searchable,
 * provider-grouped list with a detail sidecar: hovering or focusing a row
 * previews that model's description and real effort levels on the right,
 * and tapping a previewed effort selects (current model: effort only, like
 * the Effort pane; another model: model plus effort together) and
 * dismisses. Model rows stay single-shot: clicking one selects it and
 * closes. Data and submission ride the SAME per-session ModelDirectory as
 * the /model popup; exact-model reasoning metadata and the selected effort
 * come from the Host rather than a client-owned vocabulary. A rejected
 * selection announces through the shared transient Toast anchored to the
 * composer card; the in-menu strip with Retry remains the catalog-load
 * surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoning, ModelReasoningEffort, ModelSelection } from '@greeneek/gnk-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconSearchOutline16, IconWarningOutline16, Toast,
} from '@greeneek/gnk-client-ui-primitives'
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import type { ModelKey } from './locales.ts'
import { compareEffortIds, isOfferedEffort } from './preview.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'
/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/**
 * The model's real effort levels in canonical power-scale order, with a
 * leading Default row only when the adapter configures no model default.
 * Shared by the drilled Effort pane and the model detail sidecar so both
 * offer exactly what the Host declares — never a client vocabulary.
 */
function reasoningChoices(
  reasoning: ModelReasoning | undefined,
  t: (key: ModelKey, params?: Record<string, string>) => string,
): EffortChoice[] {
  if (reasoning === undefined) return []
  return [
    ...reasoning.defaultEffort === undefined
      ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
      : [],
    ...reasoning.efforts
      .filter((effort: ModelReasoningEffort) => isOfferedEffort(effort.id))
      .sort((a, b) => compareEffortIds(a.id, b.id))
      .map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
  ]
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // Model-pane search narrows the provider-grouped list by name,
  // description, or provider; it resets whenever the menu opens or closes
  // so a stale filter never greets the next open.
  const [query, setQuery] = useState('')
  // Detail sidecar: opaque `provider/model` key of the hovered or focused
  // row, or null to follow the current selection.
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(
    () => reasoningChoices(reasoning, t), [reasoning, t])
  const busy = state.status === 'selecting'

  // The search narrows rows by model name, catalog description, or provider
  // name; providers with no matching row hide entirely. An empty query
  // keeps the exact unfiltered render, so the list is untouched until
  // typed in.
  const needle = query.trim().toLowerCase()
  const filteredSections = useMemo(() => state.groups
    .map(group => ({
      group,
      models: needle === ''
        ? group.models
        : group.models.filter(model =>
          model.name.toLowerCase().includes(needle)
          || (model.description ?? '').toLowerCase().includes(needle)
          || group.name.toLowerCase().includes(needle)),
    }))
    .filter(entry => needle === '' || entry.models.length > 0),
  [needle, state.groups])
  const filteredChoices = useMemo(() => filteredSections.flatMap(
    entry => entry.models.map(model => ({ group: entry.group, model }))),
  [filteredSections])

  // The previewed row: the hovered/focused key while it names a visible
  // row, else the current selection while visible, else the first visible
  // row. The detail sidecar never goes blank while rows exist.
  const previewChoice = useMemo(() => {
    const pools = filteredChoices.length > 0 ? [filteredChoices, choices] : [choices]
    for (const pool of pools) {
      const hovered = previewKey === null
        ? undefined
        : pool.find(choice => `${choice.group.id}/${choice.model.id}` === previewKey)
      if (hovered !== undefined) return hovered
      const current = state.current === null
        ? undefined
        : pool.find(choice => choice.group.id === state.current?.provider
          && choice.model.id === state.current.model)
      if (current !== undefined) return current
      if (pool.length > 0) return pool[0]
    }
    return undefined
  }, [filteredChoices, choices, previewKey, state.current])
  const previewIsCurrent = previewChoice !== undefined
    && state.current !== null
    && previewChoice.group.id === state.current.provider
    && previewChoice.model.id === state.current.model
  const previewEffortChoices = useMemo<readonly EffortChoice[]>(
    () => reasoningChoices(previewChoice?.model.reasoning, t), [previewChoice, t])
  // The marked effort in the detail: the live selection for the current
  // model, the provider default for any other row.
  const previewEffort = previewIsCurrent
    ? effectiveEffort
    : previewChoice?.model.reasoning?.defaultEffort

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setQuery('')
    setPreviewKey(null)
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    setQuery('')
    setPreviewKey(null)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // A live filter clears first so one Escape never discards both the
      // query and the pane it was narrowing.
      if (document.activeElement === searchRef.current && query !== '') {
        setQuery('')
        return
      }
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = itemRefs.current.filter(item => item !== null)
      // The search box is not a menu row: arrows from it jump straight to
      // the first (down) or last (up) visible row.
      if (document.activeElement === searchRef.current && items.length > 0) {
        ;(event.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus()
        return
      }
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean, dismiss = true): void => {
    if (accepted) {
      if (dismiss && rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined, dismiss = true): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    // List rows are single-shot: picking one selects and dismisses, like the
    // model list (a re-pick of the active level just closes).
    void select(selection).then((accepted) => { settleSelection(accepted, dismiss) })
  }

  // Tap an effort in the detail sidecar: for the current model this is the
  // same effort-only selection as the Effort pane; for any other row it
  // selects that model with the tapped effort in one call. Either way the
  // menu dismisses on acceptance, like every other pick here.
  const choosePreviewEffort = (effort: string | undefined): void => {
    if (previewChoice === undefined) return
    if (previewIsCurrent) {
      chooseEffort(effort)
      return
    }
    lastActionRef.current = 'select'
    void select({
      provider: previewChoice.group.id,
      model: previewChoice.model.id,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }).then(settleSelection)
  }

  const waiting = state.current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model.name
      ?? (state.current === null ? t('trigger.fallback') : `${state.current.provider}/${state.current.model}`)
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : state.current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={clsx(css.menu, pane === 'model' && css.menuWide)}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div className={css.modelColumns}>
                <div className={css.modelList}>
                  <div className={css.search}>
                    <IconSearchOutline16 className={css.searchIcon} />
                    <input
                      ref={searchRef}
                      type="search"
                      className={css.searchInput}
                      aria-label={t('model.searchAria')}
                      placeholder={t('model.searchPlaceholder')}
                      value={query}
                      disabled={busy}
                      onChange={(event) => { setQuery(event.target.value) }}
                    />
                  </div>
                  <div className={clsx(css.groups, 'scrollable')}>
                    {filteredSections.map(({ group, models }) => {
                      const headingId = `${id}-${group.id}`
                      return (
                        <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                          <div className={css.groupTitle} id={headingId}>{group.name}</div>
                          {models.map((model) => {
                            const selected = state.current?.provider === group.id
                              && state.current.model === model.id
                            const key = `${group.id}/${model.id}`
                            return (
                              <button
                                ref={itemRef()}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                className={clsx(css.option, selected && css.selected)}
                                key={model.id}
                                title={model.name}
                                disabled={busy}
                                onClick={() => { choose({ provider: group.id, model: model.id }) }}
                                onMouseEnter={() => { setPreviewKey(key) }}
                                onFocus={() => { setPreviewKey(key) }}
                              >
                                <span className={css.optionCopy}>
                                  <span className={css.modelName}>{model.name}</span>
                                </span>
                                <span className={css.check}>
                                  {selected ? <IconCheckOutline16 /> : null}
                                </span>
                              </button>
                            )
                          })}
                        </section>
                      )
                    })}
                  </div>
                  {state.status === 'ready' && choices.length === 0 && (
                    <div className={css.empty}>{t('empty.models')}</div>
                  )}
                  {needle !== '' && filteredChoices.length === 0 && (
                    <div className={css.empty}>{t('model.emptySearch')}</div>
                  )}
                </div>
                {previewChoice !== undefined && (
                  <div aria-label={t('panel.detailAria')} className={css.detail}>
                    <p className={css.detailTitle}>{previewChoice.model.name}</p>
                    <p className={css.detailProvider}>{previewChoice.group.name}</p>
                    {previewChoice.model.description !== undefined && (
                      <p className={css.detailDescription}>{previewChoice.model.description}</p>
                    )}
                    {previewEffortChoices.length > 0 && (
                      <div className={css.detailEffort}>
                        <p className={css.detailEffortTitle}>{t('menu.effort')}</p>
                        <div
                          aria-label={t('menu.effort')}
                          className={css.effortSegments}
                          role="radiogroup"
                        >
                          {previewEffortChoices.map((choice) => {
                            const checked = previewEffort === choice.effort
                            return (
                              <button
                                ref={itemRef()}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                className={clsx(css.effortSegment, checked && css.effortSegmentChecked)}
                                key={choice.key}
                                disabled={busy}
                                onClick={() => { choosePreviewEffort(choice.effort) }}
                              >
                                {choice.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : (
                  <div
                    aria-label={t('menu.effort')}
                    className={css.effortSegments}
                    role="radiogroup"
                  >
                    {effortChoices.map((choice) => {
                      const checked = effectiveEffort === choice.effort
                      return (
                        <button
                          ref={itemRef()}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          className={clsx(css.effortSegment, checked && css.effortSegmentChecked)}
                          key={choice.key}
                          disabled={busy}
                          onClick={() => { chooseEffort(choice.effort) }}
                        >
                          {choice.label}
                        </button>
                      )
                    })}
                  </div>
                )}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}

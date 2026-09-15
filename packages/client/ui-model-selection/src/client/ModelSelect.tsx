/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own pane. The Model pane is the searchable,
 * provider-grouped model list — one click selects and keeps the menu open
 * for browsing. The Effort pane is a stepped slider over the current
 * model's real levels — Default first when the adapter configures no model
 * default, stops in declaration order — committing on release or keypress.
 * Model rows stay single-line under their provider group. Data and submission ride the SAME per-session ModelDirectory as
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
  IconCheckOutline16, IconChevronDownOutline14,
  IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronUpOutline14,
  IconSearchOutline16, IconWarningOutline16, Toast,
} from '@greeneek/gnk-client-ui-primitives'
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import type { ModelKey } from './locales.ts'
import css from './ModelSelect.module.css'
import { EffortSlider, type EffortChoice } from './EffortSlider.tsx'

/**
 * The model's effort levels exactly as the Host declares them — ids and
 * names verbatim, in declaration order — with a leading Default row only
 * when the adapter configures no model default. Shared by the drilled
 * Effort pane and the model detail sidecar: the user gets the provider's
 * real levels under their real names, never a client-side vocabulary, and
 * nothing declared is hidden or re-ranked.
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
    ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
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
  // Two-level menu: the overview pairs the Model row with the Effort entry;
  // the Model row drills into the searchable list, the Effort entry into the
  // stepped slider. The view resets on every open so the overview greets.
  const [view, setView] = useState<'menu' | 'models' | 'effort'>('menu')
  // description, or provider; it resets whenever the menu opens or closes
  // so a stale filter never greets the next open.
  const [query, setQuery] = useState('')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
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
  const busy = state.status === 'selecting'
  // The Effort pane's stops: the current model's real levels under their
  // real names, Default first when the adapter configures no model default.
  const sliderChoices = currentChoice?.model.reasoning === undefined
    ? []
    : reasoningChoices(currentChoice.model.reasoning, t)
  const sliderIndex = Math.max(0, sliderChoices.findIndex(choice => choice.effort === effectiveEffort))

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
    setQuery('')
    setView('menu')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  // Drilling between overview and panes moves focus to the pane's primary
  // control; stale row refs clear whenever the list unmounts so arrow
  // navigation never lands on a detached row.
  useEffect(() => {
    if (!open) return
    if (view !== 'models') itemRefs.current = []
    const target = view === 'models'
      ? searchRef.current
      : view === 'effort'
        ? menuRef.current?.querySelector('[role="slider"]')
        : menuRef.current?.querySelector('[data-menu-first]')
    if (target instanceof HTMLElement) target.focus()
  }, [open, view])

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (view === 'models' && document.activeElement === searchRef.current && query !== '') {
        setQuery('')
        return
      }
      close(true)
      return
    }
    if (!open || view !== 'models') return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = itemRefs.current.filter(item => item !== null)
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
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then((accepted) => { settleSelection(accepted, false) })
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    // A re-pick of the active level is a no-op: the menu stays open either
    // way — effort selection never dismisses, like model selection.
    if (effectiveEffort === effort) return
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then((accepted) => { settleSelection(accepted, false) })
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
          ref={menuRef}
          className={css.menu}
          role="dialog"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
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
          {view === 'menu' && (
            <div className={css.menuView}>
              <button
                type="button"
                role="menuitem"
                data-menu-first
                className={css.menuRow}
                onClick={() => { setView('models') }}
              >
                <span className={css.menuRowLabel}>{t('menu.model')}</span>
                <span className={css.menuRowValue}>{modelLabel}</span>
                <IconChevronRightOutline14 aria-hidden="true" className={css.menuRowChevron} />
              </button>
              <div className={css.menuDivider} role="separator" />
              <button
                type="button"
                className={css.effortChip}
                disabled={sliderChoices.length === 0 || busy}
                onClick={() => { setView('effort') }}
              >
                <span className={css.effortChipLabel}>
                  {t('menu.effort')}
                  {effortLabel !== undefined && ` · ${effortLabel}`}
                </span>
                <IconChevronUpOutline14 aria-hidden="true" />
              </button>
              {sliderChoices.length === 0 && (
                <p className={css.effortEmpty}>{t('empty.efforts')}</p>
              )}
            </div>
          )}
          {view === 'models' && (
            <div className={css.modelsView}>
              <button type="button" className={css.backButton} onClick={() => { setView('menu') }}>
                <IconChevronLeftOutline14 aria-hidden="true" />
                <span>{t('menu.model')}</span>
              </button>
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
          )}
          {view === 'effort' && (
            <div className={css.effortView}>
              <button type="button" className={css.backButton} onClick={() => { setView('menu') }}>
                <IconChevronLeftOutline14 aria-hidden="true" />
                <span>{t('menu.effort')}</span>
              </button>
              {sliderChoices.length > 0 ? (
                <EffortSlider
                  choices={sliderChoices}
                  index={sliderIndex}
                  disabled={busy}
                  label={t('effort.sliderAria')}
                  onCommit={chooseEffort}
                />
              ) : (
                <p className={css.effortEmpty}>{t('empty.efforts')}</p>
              )}
            </div>
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

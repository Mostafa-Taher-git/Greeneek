/**
 * Search-engine preference row registered into the General section item slot:
 * title + description + engine selector pill, with endpoint/model inputs
 * while the Custom engine is active. Registered by this package — the
 * search feature owns its own settings surface.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@greeneek/gnk-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@greeneek/gnk-client-ui-primitives'
import type {} from '@greeneek/gnk-client-ui-settings/client'
import {
  ENGINE_AUTO, ENGINE_CUSTOM, ENGINE_DUCKDUCKGO, ENGINE_EXA, ENGINE_GOOGLE, ENGINE_PERPLEXITY,
} from '../search-engine-settings.ts'
import type { createSearchEngineRowStore } from './search-engine-store.ts'
import type { SettingsWebSearchKey } from '../locales.ts'
import css from './SearchEngineRow.module.css'

/** Injected business face: the engine write plus the custom-endpoint write (t rides the standard locale seat). */
export interface SearchEngineRowInjected {
  /** Pin one offered engine id ('' returns to auto-select); unknown ids throw. */
  setEngine: (id: string) => void
  /** Save the custom endpoint base and model; blanks clear the saved value. */
  setCustom: (baseURL: string, model: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type SearchEngineRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSearchEngineRowStore>>
  & PropsLocale<'settings.web-search'> & SearchEngineRowInjected

/** Engine option ids in display order, each labeled through the row dictionary. */
const OPTION_IDS = [ENGINE_AUTO, ENGINE_DUCKDUCKGO, ENGINE_GOOGLE, ENGINE_EXA, ENGINE_PERPLEXITY, ENGINE_CUSTOM] as const

/** Dictionary key for one engine option label. */
function optionLabel(id: string): SettingsWebSearchKey {
  switch (id) {
    case ENGINE_AUTO: return 'engine.auto'
    case ENGINE_DUCKDUCKGO: return 'engine.duckduckgo'
    case ENGINE_GOOGLE: return 'engine.google'
    case ENGINE_EXA: return 'engine.exa'
    case ENGINE_PERPLEXITY: return 'engine.perplexity'
    default: return 'engine.custom'
  }
}

/**
 * Render the search-engine row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function SearchEngineRow({ t, setEngine, setCustom, useStore }: SearchEngineRowComponentProps) {
  const engine = useStore(s => s.engine)
  const customBaseURL = useStore(s => s.customBaseURL)
  const customModel = useStore(s => s.customModel)
  const [open, setOpen] = useState(false)
  const [endpoint, setEndpoint] = useState(customBaseURL)
  const [model, setModel] = useState(customModel)
  const [editingEndpoint, setEditingEndpoint] = useState(false)
  const [editingModel, setEditingModel] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('engine.title')}</div>
        <div className={css.desc}>{t('engine.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTION_IDS.map(id => ({ id, label: t(optionLabel(id)) }))}
        selectedId={engine}
        onSelect={(id) => {
          setEngine(id)
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            {t(optionLabel(engine))}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
      {engine === ENGINE_CUSTOM && (
        <div className={css.custom}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('custom.endpointLabel')}</span>
            <input
              className={css.input}
              value={editingEndpoint ? endpoint : customBaseURL}
              placeholder={t('custom.endpointPlaceholder')}
              onChange={(event) => {
                setEditingEndpoint(true)
                setEndpoint(event.target.value)
              }}
              onBlur={() => { setEditingEndpoint(false) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('custom.modelLabel')}</span>
            <input
              className={css.input}
              value={editingModel ? model : customModel}
              placeholder={t('custom.modelPlaceholder')}
              onChange={(event) => {
                setEditingModel(true)
                setModel(event.target.value)
              }}
              onBlur={() => { setEditingModel(false) }}
            />
          </label>
          <div className={css.customRow}>
            <span className={css.hint}>{t('custom.hint')}</span>
            <button
              type="button"
              className={css.save}
              onClick={() => {
                setCustom(editingEndpoint ? endpoint : customBaseURL, editingModel ? model : customModel)
              }}
            >
              {t('custom.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

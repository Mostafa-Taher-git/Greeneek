/**
 * The web-search provider's card: the provider picker, then — while Custom
 * is active — its endpoint, its per-request search budget, and the key,
 * which is written through the credentials domain, never into the settings
 * section, so the literal never rides a response.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@greeneek/gnk-client-ui-primitives'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import {
  PROVIDER_AUTO, PROVIDER_CUSTOM, PROVIDER_DUCKDUCKGO, PROVIDER_EXA, PROVIDER_GOOGLE, PROVIDER_PERPLEXITY,
} from './web-search-card-controller.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import type { WebSearchCardFace } from './web-search-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './WebSearchCard.module.css'

/** Props the renderer binds for the web-search card. */
export type WebSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebSearchCardFace>

/** Provider option ids in display order, each labeled through the card dictionary. */
const OPTION_IDS = [
  PROVIDER_AUTO, PROVIDER_DUCKDUCKGO, PROVIDER_GOOGLE, PROVIDER_EXA, PROVIDER_PERPLEXITY, PROVIDER_CUSTOM,
] as const

/** Dictionary key for one provider option label. */
function optionLabel(id: string): PluginsSettingsLocaleKey {
  switch (id) {
    case PROVIDER_AUTO: return 'webSearch.providerAuto'
    case PROVIDER_DUCKDUCKGO: return 'webSearch.providerDuckDuckGo'
    case PROVIDER_GOOGLE: return 'webSearch.providerGoogle'
    case PROVIDER_EXA: return 'webSearch.providerExa'
    case PROVIDER_PERPLEXITY: return 'webSearch.providerPerplexity'
    default: return 'webSearch.providerCustom'
  }
}

/**
 * Render the web-search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebSearchCard(props: WebSearchCardProps) {
  const { t } = props
  const state = props.useWebSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  const [open, setOpen] = useState(false)
  return (
    <PluginCard
      t={t}
      titleKey="webSearchTitle"
      descriptionKey="webSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.provider}>
        <span className={css.providerLabel}>{t('webSearch.provider')}</span>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={OPTION_IDS.map(id => ({ id, label: t(optionLabel(id)) }))}
          selectedId={state.provider}
          onSelect={(id) => {
            props.setProvider(id)
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
              disabled={disabled}
              onClick={() => { setOpen(v => !v) }}
            >
              {t(optionLabel(state.provider))}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
      </div>
      {state.provider === PROVIDER_CUSTOM
        ? (
          <>
            <SecretField
              id="plugin-config-web-search-key"
              label={t('webSearchApiKey')}
              hint={t('webSearchApiKeyHint')}
              // The credentials domain accepts a key even when the settings document
              // itself is read-only; they are separate stores with separate refusals.
              // Its own writability is what disables this control — a key sourced
              // from the process environment cannot be written from here.
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('webSearchApiKeySet') : t('webSearchApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
            <ValueField
              id="plugin-config-web-search-endpoint"
              label={t('webSearchBaseUrl')}
              hint={t('webSearchBaseUrlHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.baseURL}
              onEdit={(text) => { props.edit('baseURL', text) }}
              onReset={() => { props.resetField('baseURL') }}
            />
            <ValueField
              id="plugin-config-web-search-model"
              label={t('webSearchModel')}
              hint={t('webSearchModelHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.model}
              onEdit={(text) => { props.edit('model', text) }}
              onReset={() => { props.resetField('model') }}
            />
            <ValueField
              id="plugin-config-web-search-max-uses"
              label={t('webSearchMaxUses')}
              hint={t('webSearchMaxUsesHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              numeric
              disabled={disabled}
              {...state.maxUses}
              onEdit={(text) => { props.edit('maxUses', text) }}
              onReset={() => { props.resetField('maxUses') }}
            />
          </>
        )
        : <p className={css.hint}>{t('webSearch.providerHint')}</p>}
    </PluginCard>
  )
}

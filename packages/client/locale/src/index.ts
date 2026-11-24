/** Host registration for the browser locale preference and its model-facing instruction. */

import type { Context } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-settings'
import type {} from '@greeneek/gnk-system-prompt'
import {
  LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema,
  type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type BuiltInLocaleId, type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/** Stable section name; its text is assembled into every request header when a locale is selected. */
const RESPONSE_LOCALE_SECTION = 'session:locale'

/** Language names the model can act on, keyed by the shipped locale ids. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ar: 'Arabic',
}

/**
 * Resolve the selected locale from the optional Host settings service.
 * @param ctx - Host context that may acquire the settings service.
 * @returns the durable preference, or undefined when no locale was selected.
 */
function selectedLocale(ctx: Context): LocaleId | undefined {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  const section = settings.get(LOCALE_SETTINGS_NAMESPACE) as LocaleSettings | undefined
  const preference = section?.preference
  return preference === undefined || preference === '' ? undefined : preference
}

/**
 * Register the durable locale section and the model-visible response-language instruction.
 *
 * The instruction is rendered into `request/header`, so every model request that
 * used it is reconstructable from the session log without a new event type.
 * @param ctx - Host context whose optional services own settings and prompt sections.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      LOCALE_SETTINGS_NAMESPACE,
      LocaleSettingsSchema,
    )
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: RESPONSE_LOCALE_SECTION,
      order: promptCtx.systemPrompt.getSectionOrder('RESPONSE_LOCALE'),
      text: () => {
        const locale = selectedLocale(ctx)
        if (locale === undefined) return ''
        const language = LANGUAGE_NAMES[locale.toLowerCase()] ?? locale
        return `The session locale is ${language} (${locale}). Write all user-facing prose in ${language}. Keep code, commands, identifiers, file paths, and tool names verbatim.`
      },
    })
  })
}

/** Locale preference stored in the Host user-settings document. */

import z from '@greeneek/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Accepted BCP 47-style language ids. */
export const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** Locale identifiers shipped by the browser client. */
export const LOCALE_IDS = ['zh', 'en', 'ar'] as const

/** Locale identifier shipped by the browser client. */
export type BuiltInLocaleId = typeof LOCALE_IDS[number]

/** Open locale identifier accepted from language-pack plugins. */
export type LocaleId = string

/** BCP 47 tag each shipped locale writes to `<html lang>`. */
export const LOCALE_DOCUMENT_TAGS = {
  zh: 'zh-CN',
  en: 'en',
  ar: 'ar',
} as const satisfies Record<BuiltInLocaleId, string>

/**
 * Primary language subtags whose scripts run right to left. Direction is a
 * property of the language, not of the dictionary, so an external language
 * pack such as `fa-IR` reads right to left without declaring it.
 */
const RIGHT_TO_LEFT_SUBTAGS: ReadonlySet<string> = new Set([
  'ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'khw', 'ks', 'nqo', 'prs', 'ps', 'sd', 'ug', 'ur', 'yi',
])

/**
 * Text direction of a locale id, derived from its primary language subtag.
 * @param id - BCP 47-style locale id.
 * @returns `rtl` for right-to-left scripts, `ltr` otherwise.
 */
export function textDirectionOf(id: LocaleId): 'ltr' | 'rtl' {
  return RIGHT_TO_LEFT_SUBTAGS.has(id.toLowerCase().split('-')[0] ?? '') ? 'rtl' : 'ltr'
}

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /** Explicit locale selection; absence delegates to the browser. */
  preference?: LocaleId
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsSchema: z<LocaleSettings> = z.object({
  [LOCALE_PREFERENCE_FIELD]: z.string().pattern(LOCALE_ID_PATTERN).required(false),
})

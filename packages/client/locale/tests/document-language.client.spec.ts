// @vitest-environment jsdom
/**
 * `<html lang>` and `<html dir>` track the active locale.
 *
 * The served markup declares one language, but the resolved locale may differ
 * (browser detection, or a stored Host preference adopted after activation),
 * and it changes again whenever the user switches. Assistive technology and
 * browser features read these attributes, and an Arabic page laid out left to
 * right misplaces every inline run, so a stale value misreports or mislays the
 * document rather than merely looking untidy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@greeneek/gnk-client-ui-settings/client'
import { TestRemote } from '@greeneek/gnk-client-test-runtime'
import { apply, inject } from '@greeneek/gnk-client-locale/client'
import type { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'

/** Boot the plugin over a stub Host settings document. */
async function bench(preference?: string) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let stored = preference
  let revision = 0
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: stored === undefined ? {} : { preference: stored },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describeRpc = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
    stored = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx, { settings: { describe: describeRpc, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, locale: ctx.get('locale') as LocaleRuntime }
}

const langOf = (): string => document.documentElement.lang
const dirOf = (): string => document.documentElement.dir

describe('document language', () => {
  beforeEach(() => {
    // The served markup declares the product default; the plugin must not
    // depend on that value already being correct.
    document.documentElement.lang = 'en'
    document.documentElement.dir = ''
    Object.defineProperty(navigator, 'languages', { value: ['zh-CN'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
  })

  afterEach(() => {
    // navigator properties are installed with defineProperty above, so they
    // are removed the same way; nothing here goes through vi.stubGlobal.
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })

  it('states the resolved locale at activation, not the value the markup shipped', async () => {
    // A Chinese browser resolves zh even though the markup said en.
    const { locale } = await bench()
    expect(locale.getLocale().active).toBe('zh')
    expect(langOf()).toBe('zh-CN')
  })

  it('follows a locale switch in both directions with BCP 47 tags', async () => {
    const { locale } = await bench()
    expect(langOf()).toBe('zh-CN')
    locale.setLocale('en')
    // `en` needs no region; `zh` names its script variant, which bare `zh`
    // leaves ambiguous for pronunciation and font selection.
    expect(langOf()).toBe('en')
    locale.setLocale('zh')
    expect(langOf()).toBe('zh-CN')
  })

  it('states the text direction at activation and flips it with the locale', async () => {
    const { locale } = await bench()
    // Activation states the direction, not only later switches.
    expect(dirOf()).toBe('ltr')

    locale.setLocale('ar')
    expect(langOf()).toBe('ar')
    expect(dirOf()).toBe('rtl')

    locale.setLocale('en')
    expect(langOf()).toBe('en')
    expect(dirOf()).toBe('ltr')

    locale.setLocale('zh')
    expect(langOf()).toBe('zh-CN')
    expect(dirOf()).toBe('ltr')
  })

  it('follows an explicit Host preference that overrides browser detection', async () => {
    // Stored preference wins over the zh browser pinned above.
    const { locale } = await bench('en')
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('en') })
    await vi.waitFor(() => { expect(langOf()).toBe('en') })
  })

  it('uses an external locale definition for the document language', async () => {
    const { locale } = await bench()
    locale.addLanguage({ id: 'pt-BR', label: 'Português', fallback: 'en' })
    locale.setLocale('pt-BR')
    expect(langOf()).toBe('pt-BR')
  })
})

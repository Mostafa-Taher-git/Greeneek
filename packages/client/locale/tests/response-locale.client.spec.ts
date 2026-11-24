import { Context } from '@greeneek/cordis'
import { describe, expect, it } from 'vitest'
import SystemPrompt, { renderPrompt } from '@greeneek/gnk-system-prompt'
import { SettingsProvider, type SettingsNamespace } from '@greeneek/gnk-settings'
import { apply, LOCALE_SETTINGS_NAMESPACE } from '../src/index.ts'
import { textDirectionOf } from '../src/locale-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin({ apply }).await()
  return ctx
}

describe('model-visible response locale', () => {
  it('leaves the prompt unchanged when no locale was selected', async () => {
    const ctx = await boot()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('session locale')
  })

  it('instructs the model to answer in Arabic and marks the document RTL', async () => {
    const ctx = await boot()
    await ctx.settings.update(LOCALE_SETTINGS_NAMESPACE, { preference: 'ar' })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('The session locale is Arabic (ar).')
    expect(prompt).toContain('Write all user-facing prose in Arabic.')
    expect(textDirectionOf('ar')).toBe('rtl')
  })

  it('pins the assembled Arabic prompt as a keyless snapshot', async () => {
    const ctx = await boot()
    await ctx.settings.update(LOCALE_SETTINGS_NAMESPACE, { preference: 'ar' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toMatchInlineSnapshot(`
      "You are an AI agent powered by Greeneek.

      The session locale is Arabic (ar). Write all user-facing prose in Arabic. Keep code, commands, identifiers, file paths, and tool names verbatim."
    `)
  })

  it('tracks a later locale change through the same section', async () => {
    const ctx = await boot()
    await ctx.settings.update(LOCALE_SETTINGS_NAMESPACE, { preference: 'zh' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Write all user-facing prose in Simplified Chinese.')
    await ctx.settings.update(LOCALE_SETTINGS_NAMESPACE, { preference: 'en' })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('Write all user-facing prose in English.')
    expect(prompt).not.toContain('Simplified Chinese')
  })
})

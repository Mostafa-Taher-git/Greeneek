/**
 * Settings-driven provider selection: the `web` settings section overlays the
 * composition entry, and a saved engine choice applies to the next search
 * with no restart. Real dynamic composition over a temp harness home.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebRuntime, { WEB_SETTINGS_NAMESPACE } from '@greeneek/gnk-web'
import type { WebSearchResult } from '@greeneek/gnk-web'
import type {} from '@greeneek/gnk-settings'
import { FileSettingsProvider } from '@greeneek/gnk-settings-file'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gnk-web-dynamic-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function stubSearch(id: string) {
  return {
    id,
    available: () => true,
    search: async ({ query }: { query: string }): Promise<WebSearchResult> =>
      ({ sources: [], truncated: false, content: `${id}:${query}` }),
  }
}

async function boot(dir: string): Promise<Context> {
  vi.stubEnv('GNK_HOME', dir)
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  await ctx.plugin(WebRuntime, {})
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  ctx.web.registerSearchProvider(stubSearch('alpha'))
  ctx.web.registerSearchProvider(stubSearch('beta'))
  return ctx
}

describe('web settings-driven selection', () => {
  it('registers the web namespace and auto-selects while the section is empty', async () => {
    const ctx = await boot(await home())
    const described = ctx.settings.describe()
    expect(described.some(entry => entry.ns === WEB_SETTINGS_NAMESPACE)).toBe(true)
    // Two usable providers with no configured id is ambiguous, not first-wins.
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_AMBIGUOUS' }))
  })

  it('applies a saved engine choice to the next search with no restart', async () => {
    const ctx = await boot(await home())
    await ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'beta' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'beta:q' })

    await ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'alpha' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'alpha:q' })
  })

  it('returns to auto-select when the saved choice is cleared', async () => {
    const ctx = await boot(await home())
    await ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'beta' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'beta:q' })

    await ctx.settings.replace(WEB_SETTINGS_NAMESPACE, {})
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_AMBIGUOUS' }))
  })

  it('keeps the composition entry when no settings provider is present', async () => {
    const ctx = new Context()
    cleanups.push(async () => {
      await ctx.fiber.dispose()
    })
    await ctx.plugin(WebRuntime, { searchProvider: 'alpha' })
    ctx.web.registerSearchProvider(stubSearch('alpha'))
    ctx.web.registerSearchProvider(stubSearch('beta'))
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'alpha:q' })
  })
})

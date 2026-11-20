import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import BrowserAIRegistry, { BUILTIN_PROVIDERS } from '../src/index.ts'

async function boot() {
  const ctx = new Context()
  const browser = {
    open: vi.fn(async () => ({ profile: 'default', url: '', status: 'open' as const, titleSource: 'unknown' as const, source: 'user' as const })),
    read: vi.fn(async () => ({ url: '', title: '', text: '', links: [], status: 200, truncated: false })),
  }
  ctx.provide('browser', browser)
  await ctx.plugin(BrowserAIRegistry)
  return { ctx, browser }
}

describe('BrowserAIRegistry', () => {
  it('declares the three official providers with independent capabilities', () => {
    expect(BUILTIN_PROVIDERS.map(p => p.id)).toEqual(['chatgpt', 'claude', 'gemini'])
    for (const provider of BUILTIN_PROVIDERS) {
      expect(provider.manual).toBe(true)
      expect(provider.automation).toBe(false)
      expect(provider.automationReason).toBeTruthy()
      expect(provider.termsSource).toBeTruthy()
    }
  })

  it('opens an official site in a provider-isolated profile', async () => {
    const { ctx, browser } = await boot()
    const session = await ctx.browserAI.openManual('chatgpt')
    expect(session.status).toBe('connected')
    expect(session.profile).toBe('provider:chatgpt')
    expect(browser.open).toHaveBeenCalledWith(undefined, {
      profile: 'provider:chatgpt', url: 'https://chatgpt.com/',
    })
    await ctx.fiber.dispose()
  })

  it('refuses automation by name with the exact reason', async () => {
    const { ctx } = await boot()
    expect(() => ctx.browserAI.automate('claude', undefined))
      .toThrow(/automation for claude is not supported/)
    await ctx.fiber.dispose()
  })

  it('never emits credential material in a session projection', async () => {
    const { ctx } = await boot()
    const session = ctx.browserAI.status('gemini')
    expect(JSON.stringify(session)).not.toMatch(/password|cookie|token|secret/i)
    expect(session.status).toBe('login-required')
    await ctx.fiber.dispose()
  })

  it('fails with a stable code for an unknown provider', async () => {
    const { ctx } = await boot()
    expect(() => ctx.browserAI.get('unknown')).toThrow('unknown browser AI provider unknown')
    expect(() => ctx.browserAI.get('unknown')).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' }))
    await ctx.fiber.dispose()
  })
})

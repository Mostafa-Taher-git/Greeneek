import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import BrowserAIRegistry from '@greeneek/gnk-browser-ai'
import { apply } from '../src/index.ts'
import type { CommandInvocation } from '@greeneek/gnk-commands'

function invocation(rawInput: string): CommandInvocation {
  return {
    commandId: 'cmd-1' as never,
    agent: { id: 'a' } as never,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  }
}

describe('/browser-ai command', () => {
  it('lists the three providers with independent capability declarations', async () => {
    const ctx = new Context()
    const registered: Array<{ name: string; handler: (i: CommandInvocation) => unknown }> = []
    ctx.provide('browser', { open: vi.fn(async () => ({})), read: vi.fn(async () => ({})) })
    ctx.provide('commands', { register: (d: { name: string; handler: (i: CommandInvocation) => unknown }) => { registered.push(d) } })
    await ctx.plugin(BrowserAIRegistry)
    await ctx.plugin({ name: 'command-browser-ai-test', inject: ['commands', 'browserAI'], apply })
    expect(registered[0]?.name).toBe('browser-ai')
    const result = await registered[0]!.handler(invocation('')) as { kind: string; text: string }
    expect(result.kind).toBe('success')
    expect(result.text).toContain('chatgpt')
    expect(result.text).toContain('claude')
    expect(result.text).toContain('gemini')
    expect(result.text).toContain('automation=no')
    await ctx.fiber.dispose()
  })

  it('opens a provider in its isolated session', async () => {
    const ctx = new Context()
    const registered: Array<{ handler: (i: CommandInvocation) => unknown }> = []
    const open = vi.fn(async () => ({ status: 'connected' }))
    ctx.provide('browser', { open, read: vi.fn(async () => ({})) })
    ctx.provide('commands', { register: (d: { handler: (i: CommandInvocation) => unknown }) => { registered.push(d) } })
    await ctx.plugin(BrowserAIRegistry)
    await ctx.plugin({ name: 'command-browser-ai-test', inject: ['commands', 'browserAI'], apply })
    const result = await registered[0]!.handler(invocation('chatgpt')) as { kind: string; text: string }
    expect(result.kind).toBe('success')
    expect(open).toHaveBeenCalledWith(undefined, {
      profile: 'provider:chatgpt', url: 'https://chatgpt.com/',
    })
    expect(result.text).toContain('never collects your password')
    await ctx.fiber.dispose()
  })
})

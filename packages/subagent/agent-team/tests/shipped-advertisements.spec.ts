/**
 * Gate for S8-22: every shipped provider that advertises Harness capabilities
 * must describe only what its registration actually implements. This mounts
 * the REAL provider plugins in a real Cordis context, derives each descriptor
 * through the shipped derivation, and compares the two surfaces.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SubagentRuntime from '@greeneek/gnk-subagent'
import type { HarnessCapabilities, SubagentProvider } from '@greeneek/gnk-subagent'
import LocalSubprocessRuntime from '@greeneek/gnk-subprocess-local'
import * as SubagentSpawn from '@greeneek/gnk-subagent-spawn-in-process'
import * as SubagentFork from '@greeneek/gnk-subagent-fork-in-process'
import * as SubagentCodex from '@greeneek/gnk-subagent-codex'
import * as SubagentClaudeCode from '@greeneek/gnk-subagent-claude-code'
import * as SubagentGnkSdk from '@greeneek/gnk-subagent-gnk-sdk'
import * as SubagentAcp from '@greeneek/gnk-subagent-acp'
import { harnessDescriptorFromProvider } from '../src/harness-descriptor.ts'

const ADVERTISEMENT_SOURCES: readonly HarnessCapabilities['source'][] = [
  'registration',
  'configuration',
  'acp-initialize',
  'acp-session',
]

/**
 * Mount every shipped provider without starting one. External CLI providers
 * only need the subprocess seam; the SDK provider only needs a throwaway home.
 * @param ctx - fresh test context.
 * @param roots - collects temp directories removed after the test.
 */
async function mountShippedProviders(ctx: Context, roots: string[]): Promise<void> {
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  const gnkHome = mkdtempSync(join(tmpdir(), 'gnk-advertisement-gate-'))
  roots.push(gnkHome)
  await ctx.plugin(SubagentGnkSdk, {
    providerName: 'gnk-sdk',
    profile: 'sdk',
    patches: [],
    gnkHome,
    provider: 'greeneek-official',
    model: 'greeneek-v4-flash',
    env: {},
  })
  await ctx.plugin(SubagentCodex, { providerName: 'codex' })
  await ctx.plugin(SubagentClaudeCode, { providerName: 'claude-code' })
  await ctx.plugin(SubagentAcp, { providerName: 'acp', command: process.execPath, args: [], permission: 'reject', env: {} })
}

describe('shipped Harness advertisements match the registration', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('mounts every shipped provider and keeps each descriptor honest', async () => {
    const ctx = new Context()
    await mountShippedProviders(ctx, roots)

    const names = ['spawn', 'fork', 'gnk-sdk', 'codex', 'claude-code', 'acp'] as const
    const providers: SubagentProvider[] = names
      .map(name => ctx.subagents.getProvider(name))
      .filter((provider): provider is SubagentProvider => provider !== undefined)
    expect(providers.length, 'every shipped provider name this gate pins must be mounted').toBe(names.length)

    for (const provider of providers) {
      const descriptor = harnessDescriptorFromProvider(provider)
      const advertised = provider.harnessCapabilities

      // Execution facts win: a descriptor never claims a launch the
      // registration would refuse.
      expect(descriptor.connection, `${provider.name}: connection identity`).toBe(provider.name)
      expect(descriptor.supportsContextFork, `${provider.name}: context fork`).toBe(provider.inheritsParentContext)
      expect(descriptor.state, `${provider.name}: durable lane needs prepareContinuable`)
        .toBe(provider.prepareContinuable === undefined ? 'one-shot' : 'ready')
      expect(
        descriptor.contextStrategies,
        `${provider.name}: context strategies must be execution facts`,
      ).toEqual(provider.inheritsParentContext ? ['fresh', 'fork'] : ['fresh'])
      expect(
        descriptor.supportsAgentOptions,
        `${provider.name}: agent options must not exceed the registration`,
      ).toBe(advertised?.supportsAgentOptions ?? provider.capabilities.agentOptions)
      expect(descriptor.source, `${provider.name}: advertisement source`).toBe(advertised?.source ?? 'registration')
      expect(ADVERTISEMENT_SOURCES, `${provider.name}: source vocabulary`).toContain(descriptor.source)

      if (advertised !== undefined) {
        expect(descriptor.harness, `${provider.name}: harness identity`).toBe(advertised.id)
        expect(descriptor.displayName, `${provider.name}: display name`).toBe(advertised.displayName ?? advertised.id)
        expect(descriptor.models, `${provider.name}: advertised models`).toEqual(advertised.models)
      }
    }
  })

  it('reports the Greeneek strategies as one connection that keeps both execution modes', async () => {
    const ctx = new Context()
    await mountShippedProviders(ctx, roots)
    const spawn = ctx.subagents.getProvider('spawn')
    const fork = ctx.subagents.getProvider('fork')
    expect(spawn?.harnessCapabilities?.id).toBe('greeneek')
    expect(fork?.harnessCapabilities?.id).toBe('greeneek')
    expect(fork?.harnessCapabilities?.contextStrategies).toEqual(['fresh', 'fork'])
    expect(spawn?.harnessCapabilities?.contextStrategies).toEqual(['fresh'])
  })

  it('lets live discovery win over the registration advertisement', async () => {
    const ctx = new Context()
    await mountShippedProviders(ctx, roots)
    const provider = ctx.subagents.getProvider('acp')
    if (provider === undefined) throw new Error('acp provider must be mounted')
    const descriptor = harnessDescriptorFromProvider(provider, {
      capabilities: {
        id: 'discovered-harness',
        displayName: 'Discovered',
        models: [{ id: 'm1' }],
        supportsAgentOptions: true,
        contextStrategies: ['fresh'],
        source: 'acp-initialize',
      },
      discoveredAt: '2026-11-10T00:00:00.000Z',
    }, 'probe failed')
    expect(descriptor.harness).toBe('discovered-harness')
    expect(descriptor.displayName).toBe('Discovered')
    expect(descriptor.source).toBe('acp-initialize')
    expect(descriptor.models).toEqual([{ id: 'm1' }])
    expect(descriptor.discoveredAt).toBe('2026-11-10T00:00:00.000Z')
    expect(descriptor.discoveryError).toBe('probe failed')
  })
})

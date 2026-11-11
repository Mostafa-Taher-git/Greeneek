import { describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import SubagentRuntime from '@greeneek/gnk-subagent'
import type { HarnessCapabilities, SubagentProvider } from '@greeneek/gnk-subagent'
import { HarnessRegistry } from '../src/harness-registry.ts'
import { TeamError } from '../src/error.ts'

/** One advertised capability set for a probe answer. */
function advertised(overrides: Partial<HarnessCapabilities> = {}): HarnessCapabilities {
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    models: [{ id: 'anthropic/claude', efforts: [{ id: 'high' }] }],
    supportsAgentOptions: true,
    contextStrategies: ['fresh'],
    source: 'acp-session',
    ...overrides,
  }
}

/** A registered provider with no start-time features; only discovery is exercised. */
function provider(
  name: string,
  options: {
    readonly harnessCapabilities?: HarnessCapabilities
    readonly discoverHarness?: SubagentProvider['discoverHarness']
    readonly inheritsParentContext?: boolean
    readonly agentRouteDefaults?: { provider: string; model: string }
    readonly continuable?: boolean
  } = {},
): SubagentProvider {
  return {
    name,
    capabilities: { agentOptions: true, outputSchema: false, depthLimit: false, toolFilter: false, persona: false, agentPreset: false },
    inheritsParentContext: options.inheritsParentContext ?? false,
    ...options.harnessCapabilities === undefined ? {} : { harnessCapabilities: options.harnessCapabilities },
    ...options.discoverHarness === undefined ? {} : { discoverHarness: options.discoverHarness },
    ...options.agentRouteDefaults === undefined ? {} : { agentRouteDefaults: options.agentRouteDefaults },
    ...options.continuable === true ? { prepareContinuable: () => Promise.resolve({}) } : {},
    start: () => { throw new Error('the registry never starts a run') },
  }
}

/** The advertisement every in-process Greeneek strategy ships. */
function greeneekAdvertisement(contextStrategies: readonly ('fresh' | 'fork')[]): HarnessCapabilities {
  return {
    id: 'greeneek',
    displayName: 'Greeneek',
    models: 'unknown',
    supportsAgentOptions: true,
    contextStrategies,
    source: 'registration',
  }
}

async function setup(configured: readonly string[] = [], probeTimeoutMs?: number) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  const registry = probeTimeoutMs === undefined
    ? new HarnessRegistry(ctx, configured)
    : new HarnessRegistry(ctx, configured, probeTimeoutMs)
  return { ctx, registry }
}

describe('HarnessRegistry', () => {
  it('groups connections under one Harness identity and keeps registry order', async () => {
    const { ctx, registry } = await setup()
    try {
      ctx.subagents.registerProvider(provider('opencode-work', {
        harnessCapabilities: advertised(),
      }))
      ctx.subagents.registerProvider(provider('opencode-home', {
        harnessCapabilities: advertised(),
      }))
      ctx.subagents.registerProvider(provider('spawn', {
        harnessCapabilities: {
          id: 'greeneek',
          displayName: 'Greeneek',
          models: 'unknown',
          supportsAgentOptions: true,
          contextStrategies: ['fresh'],
          source: 'registration',
        },
      }))

      expect(registry.list().map(entry => ({
        harness: entry.harness,
        displayName: entry.displayName,
        connection: entry.connection,
        canProbe: entry.canProbe,
      }))).toEqual([
        { harness: 'opencode', displayName: 'OpenCode', connection: 'opencode-work', canProbe: false },
        { harness: 'opencode', displayName: 'OpenCode', connection: 'opencode-home', canProbe: false },
        { harness: 'greeneek', displayName: 'Greeneek', connection: 'greeneek', canProbe: false },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps a configured connection visible as not-installed when no provider is mounted', async () => {
    const { ctx, registry } = await setup(['opencode-work'])
    try {
      expect(registry.list()).toEqual([{
        harness: 'opencode-work',
        displayName: 'opencode-work',
        connection: 'opencode-work',
        name: 'opencode-work',
        state: 'not-installed',
        models: 'unknown',
        supportsAgentOptions: false,
        supportsContextFork: false,
        contextStrategies: [],
        source: 'registration',
        canProbe: false,
      }])
      expect(registry.describe('absent')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('probes only connections with a discovery surface and caches the answer', async () => {
    const { ctx, registry } = await setup(['opencode-work'])
    try {
      ctx.subagents.registerProvider(provider('opencode-work', {
        harnessCapabilities: advertised({ models: 'unknown', source: 'configuration' }),
        discoverHarness: () => Promise.resolve(advertised()),
      }))
      ctx.subagents.registerProvider(provider('spawn', {
        harnessCapabilities: {
          id: 'greeneek',
          displayName: 'Greeneek',
          models: 'unknown',
          supportsAgentOptions: true,
          contextStrategies: ['fresh'],
          source: 'registration',
        },
      }))

      const refreshed = await registry.refresh()
      expect(refreshed.map(entry => ({
        connection: entry.connection,
        models: entry.models,
        source: entry.source,
        canProbe: entry.canProbe,
        discoveredAt: typeof entry.discoveredAt,
      }))).toEqual([
        {
          connection: 'opencode-work',
          models: [{ id: 'anthropic/claude', efforts: [{ id: 'high' }] }],
          source: 'acp-session',
          canProbe: true,
          discoveredAt: 'string',
        },
        {
          connection: 'greeneek',
          models: 'unknown',
          source: 'registration',
          canProbe: false,
          discoveredAt: 'undefined',
        },
      ])
      // The cache serves later reads without another probe.
      expect(registry.describe('opencode-work')?.source).toBe('acp-session')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('records a failed probe and classifies the availability it proves', async () => {
    const { ctx, registry } = await setup()
    try {
      ctx.subagents.registerProvider(provider('kilo', {
        discoverHarness: () => Promise.reject(new Error('401 Unauthorized: invalid api key')),
      }))
      await registry.refresh()
      expect(registry.describe('kilo')).toMatchObject({
        state: 'unauthenticated',
        discoveryError: '401 Unauthorized: invalid api key',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('bounds a probe that never answers and reports it temporarily unavailable', async () => {
    const { ctx, registry } = await setup([], 20)
    try {
      ctx.subagents.registerProvider(provider('slow', {
        discoverHarness: request => new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        }),
      }))
      await registry.refresh()
      expect(registry.describe('slow')).toMatchObject({
        state: 'temporarily-unavailable',
        discoveryError: 'aborted',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses a model the connection did not advertise', async () => {
    const { ctx, registry } = await setup()
    try {
      ctx.subagents.registerProvider(provider('opencode-work', {
        discoverHarness: () => Promise.resolve(advertised()),
      }))
      await registry.refresh()
      expect(registry.select('opencode-work', { model: 'missing/model' })).toEqual({
        kind: 'refused',
        code: 'HARNESS_MODEL_NOT_ADVERTISED',
        reason: 'harness "opencode-work" does not advertise model "missing/model"; available: anthropic/claude',
      })
      expect(registry.select('opencode-work', { model: 'anthropic/claude', reasoningEffort: 'high' })).toEqual({
        kind: 'selected',
        model: 'anthropic/claude',
        reasoningEffort: 'high',
        unverified: false,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('drops the cached probe when a provider is replaced', async () => {
    const { ctx, registry } = await setup()
    try {
      const dispose = ctx.subagents.registerProvider(provider('opencode-work', {
        discoverHarness: () => Promise.resolve(advertised()),
      }))
      await registry.refresh()
      expect(registry.describe('opencode-work')?.discoveredAt).toBeTypeOf('string')

      dispose()
      ctx.subagents.registerProvider(provider('opencode-work', {
        harnessCapabilities: advertised({ models: 'unknown', source: 'configuration' }),
        discoverHarness: () => Promise.resolve(advertised()),
      }))
      expect(registry.describe('opencode-work')).toMatchObject({
        models: 'unknown',
        source: 'configuration',
      })
      expect(registry.describe('opencode-work')?.discoveredAt).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refreshes one named connection without touching its siblings', async () => {
    const { ctx, registry } = await setup()
    try {
      let probed = 0
      ctx.subagents.registerProvider(provider('one', {
        discoverHarness: () => {
          probed += 1
          return Promise.resolve(advertised())
        },
      }))
      ctx.subagents.registerProvider(provider('two', {
        discoverHarness: () => Promise.reject(new Error('never called')),
      }))
      await registry.refreshOne('one')
      expect(probed).toBe(1)
      expect(await registry.refreshOne('absent')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('presents the Greeneek strategies as one ready connection while internal names keep their descriptors', async () => {
    const { ctx, registry } = await setup()
    try {
      ctx.subagents.registerProvider(provider('fork', {
        harnessCapabilities: greeneekAdvertisement(['fresh', 'fork']),
        inheritsParentContext: true,
        continuable: true,
      }))
      ctx.subagents.registerProvider(provider('spawn', {
        harnessCapabilities: greeneekAdvertisement(['fresh']),
        continuable: true,
      }))
      ctx.subagents.registerProvider(provider('claude-code'))

      expect(registry.list().map(entry => entry.connection)).toEqual(['greeneek', 'claude-code'])
      expect(registry.describe('greeneek')).toMatchObject({
        harness: 'greeneek',
        displayName: 'Greeneek',
        connection: 'greeneek',
        name: 'greeneek',
        state: 'ready',
        models: 'unknown',
        supportsAgentOptions: true,
        supportsContextFork: true,
        contextStrategies: ['fresh', 'fork'],
        source: 'registration',
        canProbe: false,
      })
      // Internal dispatch keeps reading each strategy's own descriptor.
      expect(registry.describe('fork')).toMatchObject({ connection: 'fork', supportsContextFork: true })
      expect(registry.describe('spawn')).toMatchObject({ connection: 'spawn', supportsContextFork: false })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('advertises only the context strategies the mounted strategies execute', async () => {
    const { ctx, registry } = await setup()
    try {
      const dispose = ctx.subagents.registerProvider(provider('spawn', {
        harnessCapabilities: greeneekAdvertisement(['fresh']),
        continuable: true,
      }))
      expect(registry.greeneekConnection()).toMatchObject({
        state: 'ready',
        supportsContextFork: false,
        contextStrategies: ['fresh'],
      })
      dispose()
      expect(registry.greeneekConnection()).toBeUndefined()
      expect(registry.describe('greeneek')).toBeUndefined()

      ctx.subagents.registerProvider(provider('fork', {
        harnessCapabilities: greeneekAdvertisement(['fresh', 'fork']),
        inheritsParentContext: true,
      }))
      expect(registry.greeneekConnection()).toMatchObject({
        state: 'one-shot',
        supportsContextFork: true,
        contextStrategies: ['fork'],
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('shows configured legacy strategy names as one not-installed Greeneek connection', async () => {
    const { ctx, registry } = await setup(['fork', 'spawn', 'greeneek'])
    try {
      expect(registry.list()).toEqual([expect.objectContaining({
        connection: 'greeneek',
        state: 'not-installed',
        contextStrategies: [],
      })])
      expect(registry.describe('greeneek')).toMatchObject({ state: 'not-installed' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves the Greeneek connection to the strategy that honors the context', async () => {
    const { ctx, registry } = await setup()
    try {
      ctx.subagents.registerProvider(provider('fork', {
        harnessCapabilities: greeneekAdvertisement(['fresh', 'fork']),
        inheritsParentContext: true,
        continuable: true,
      }))
      ctx.subagents.registerProvider(provider('spawn', {
        harnessCapabilities: greeneekAdvertisement(['fresh']),
        continuable: true,
      }))
      expect(registry.resolveConnection('greeneek', 'fresh')).toBe('spawn')
      expect(registry.resolveConnection('greeneek', 'fork')).toBe('fork')
      expect(registry.resolveConnection('claude-code', 'fresh')).toBe('claude-code')
      expect(registry.resolveConnection('fork', 'fresh')).toBe('fork')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves deployment-renamed strategies by capability and refuses a missing one', async () => {
    const { ctx, registry } = await setup()
    try {
      ctx.subagents.registerProvider(provider('inherited', {
        harnessCapabilities: greeneekAdvertisement(['fresh', 'fork']),
        inheritsParentContext: true,
        continuable: true,
      }))
      expect(registry.resolveConnection('greeneek', 'fork')).toBe('inherited')
      let refusal: unknown
      try {
        registry.resolveConnection('greeneek', 'fresh')
      } catch (error: unknown) {
        refusal = error
      }
      expect(refusal).toBeInstanceOf(TeamError)
      expect((refusal as TeamError).code).toBe('HARNESS_CONTEXT_NOT_SUPPORTED')
      expect((refusal as TeamError).message).toContain('no registered fresh-context strategy')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

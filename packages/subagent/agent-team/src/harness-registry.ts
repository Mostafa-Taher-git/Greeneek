/**
 * The Harness Registry: one entry per registered provider (a named Connection),
 * grouped by the Harness implementation it belongs to, enriched by live probes
 * that read what each Harness actually advertises. Registration facts are
 * always available; discovery facts are added when a provider supports probing
 * and an explicit refresh asks for them.
 * @module @greeneek/gnk-agent-team/harness-registry
 */

import type { Context } from '@greeneek/cordis'
import type { HarnessCapabilities, SubagentProvider } from '@greeneek/gnk-subagent'
import { TeamError } from './error.ts'
import { GREENEEK_HARNESS, LEGACY_GREENEEK_STRATEGIES } from './fleet-migration.ts'
import {
  harnessDescriptorFromProvider,
  resolveHarnessSelection,
  type HarnessDescriptor,
  type HarnessSelectionRequest,
  type HarnessSelectionResult,
} from './harness-descriptor.ts'

/** How long one Harness probe may take before the registry reports it unavailable. */
export const DEFAULT_HARNESS_PROBE_TIMEOUT_MS = 20_000

/** One cached probe outcome. Success and failure are distinct so both stay honest. */
type ProbeOutcome =
  | { readonly kind: 'answered'; readonly capabilities: HarnessCapabilities; readonly discoveredAt: string }
  | { readonly kind: 'failed'; readonly reason: string }

/** Live Harness discovery over the provider registry. */
export class HarnessRegistry {
  private readonly probes = new Map<string, ProbeOutcome>()

  /**
   * @param ctx - context carrying the shared subagent registry.
   * @param configured - provider names the deployment expects even when absent.
   * @param probeTimeoutMs - upper bound for one live probe.
   */
  constructor(
    private readonly ctx: Context,
    private readonly configured: readonly string[],
    private readonly probeTimeoutMs = DEFAULT_HARNESS_PROBE_TIMEOUT_MS,
  ) {
    ctx.on('subagent/provider-added', (provider) => {
      this.probes.delete(provider.name)
    })
    ctx.on('subagent/provider-removed', (name) => {
      this.probes.delete(name)
    })
  }

  /**
   * Current descriptors without starting any probe. The Greeneek execution
   * strategies present as one Harness connection at their first registry
   * position; every other provider is its own connection.
   * @returns one descriptor per user-facing connection, in registry order.
   */
  list(): HarnessDescriptor[] {
    const registered = this.ctx.subagents.list()
    const names = [...registered, ...this.configured.filter(name => !registered.includes(name))]
    const descriptors: HarnessDescriptor[] = []
    let greeneekEmitted = false
    for (const name of names) {
      const provider = this.ctx.subagents.getProvider(name)
      const greeneekStrategy = provider?.harnessCapabilities?.id === GREENEEK_HARNESS
      const configuredLegacy = provider === undefined
        && (name === GREENEEK_HARNESS || LEGACY_GREENEEK_STRATEGIES.includes(name))
      if (greeneekStrategy || configuredLegacy) {
        if (greeneekEmitted) continue
        greeneekEmitted = true
        descriptors.push(this.greeneekConnection() ?? missingConnection(GREENEEK_HARNESS))
        continue
      }
      const descriptor = this.describe(name)
      if (descriptor !== undefined) descriptors.push(descriptor)
    }
    return descriptors
  }

  /**
   * One connection's descriptor, including its latest probe outcome. The
   * Greeneek connection aggregates its registered strategies; a strategy's own
   * registry name keeps its individual descriptor for internal dispatch.
   * @param connection - provider registration name or the Greeneek connection identity.
   * @returns the descriptor, or undefined when the name is neither registered nor configured.
   */
  describe(connection: string): HarnessDescriptor | undefined {
    if (connection === GREENEEK_HARNESS) {
      const aggregate = this.greeneekConnection()
      if (aggregate !== undefined) return aggregate
      return this.configured.includes(connection) ? missingConnection(connection) : undefined
    }
    const provider = this.ctx.subagents.getProvider(connection)
    if (provider === undefined) {
      if (!this.configured.includes(connection)) return undefined
      return missingConnection(connection)
    }
    const outcome = this.probes.get(connection)
    if (outcome === undefined) return harnessDescriptorFromProvider(provider)
    if (outcome.kind === 'answered') {
      return harnessDescriptorFromProvider(provider, {
        capabilities: outcome.capabilities,
        discoveredAt: outcome.discoveredAt,
      })
    }
    return harnessDescriptorFromProvider(provider, undefined, outcome.reason)
  }

  /**
   * The Greeneek Harness as one user-facing connection aggregating its
   * registered execution strategies. Context strategies and the durable-lane
   * state are execution facts of the mounted strategies, and the connection
   * advertises no model catalog until the host LLM registry is published.
   * @returns the aggregated descriptor, or undefined when no strategy is registered.
   */
  greeneekConnection(): HarnessDescriptor | undefined {
    const strategies = this.greeneekStrategies()
    const first = strategies[0]
    if (first === undefined) return undefined
    const continuable = strategies.some(entry => entry.provider.prepareContinuable !== undefined)
    const seeds = strategies.some(entry => entry.provider.inheritsParentContext)
    const fresh = strategies.some(entry => !entry.provider.inheritsParentContext)
    return {
      harness: GREENEEK_HARNESS,
      displayName: first.provider.harnessCapabilities?.displayName ?? 'Greeneek',
      connection: GREENEEK_HARNESS,
      name: GREENEEK_HARNESS,
      state: continuable ? 'ready' : 'one-shot',
      models: 'unknown',
      supportsAgentOptions: strategies.some(entry => entry.provider.capabilities.agentOptions),
      supportsContextFork: seeds,
      contextStrategies: [...fresh ? ['fresh'] as const : [], ...seeds ? ['fork'] as const : []],
      source: 'registration',
      canProbe: false,
    }
  }

  /**
   * Resolve a user-facing connection to the registry name the roster dispatches.
   * The Greeneek connection selects its internal execution strategy by the
   * requested context, preferring the shipped default name when several
   * strategies match; every other connection is already a registry name.
   * @param connection - connection identity a fleet member or tool request names.
   * @param context - context strategy the member asks for.
   * @returns the registered provider name to dispatch.
   * @throws {TeamError} `HARNESS_CONTEXT_NOT_SUPPORTED` when no registered Greeneek strategy honors the context.
   */
  resolveConnection(connection: string, context: 'fresh' | 'fork'): string {
    if (connection !== GREENEEK_HARNESS) return connection
    const matches = this.greeneekStrategies()
      .filter(entry => entry.provider.inheritsParentContext === (context === 'fork'))
    const preferred = context === 'fork' ? 'fork' : 'spawn'
    const chosen = matches.find(entry => entry.name === preferred) ?? matches[0]
    if (chosen === undefined) {
      throw new TeamError(
        `the Greeneek Harness has no registered ${context === 'fork' ? 'seeding' : 'fresh-context'} strategy; mount the matching in-process provider`,
        'HARNESS_CONTEXT_NOT_SUPPORTED',
      )
    }
    return chosen.name
  }

  /** Registered providers implementing the Greeneek Harness, in registry order. */
  private greeneekStrategies(): { name: string; provider: SubagentProvider }[] {
    const entries: { name: string; provider: SubagentProvider }[] = []
    for (const name of this.ctx.subagents.list()) {
      const provider = this.ctx.subagents.getProvider(name)
      if (provider !== undefined && provider.harnessCapabilities?.id === GREENEEK_HARNESS) {
        entries.push({ name, provider })
      }
    }
    return entries
  }

  /**
   * Resolve one member's model and effort against a connection's advertised capabilities.
   * @param connection - provider registration name.
   * @param request - requested model, effort, and context strategy.
   * @returns a canonical selection or a named refusal.
   */
  select(connection: string, request: HarnessSelectionRequest): HarnessSelectionResult {
    return resolveHarnessSelection(this.describe(connection), request)
  }

  /**
   * Probe every connection that can answer, in parallel, and cache each outcome.
   * A provider without a probe keeps its registration facts and is not reported
   * as failed: it simply has no discovery surface.
   * @param signal - caller cancellation for all probes.
   * @returns the refreshed descriptors.
   */
  async refresh(signal?: AbortSignal): Promise<HarnessDescriptor[]> {
    const probeable = this.ctx.subagents.list()
      .filter(name => this.ctx.subagents.getProvider(name)?.discoverHarness !== undefined)
    await Promise.allSettled(probeable.map(async (name) => {
      await this.probe(name, signal)
    }))
    return this.list()
  }

  /**
   * Probe one connection and cache the outcome.
   * @param connection - provider registration name.
   * @param signal - caller cancellation for the probe.
   * @returns the refreshed descriptor, or undefined when the connection is unknown.
   */
  async refreshOne(connection: string, signal?: AbortSignal): Promise<HarnessDescriptor | undefined> {
    await this.probe(connection, signal)
    return this.describe(connection)
  }

  /** Run one probe under the configured timeout and record its outcome. */
  private async probe(connection: string, signal?: AbortSignal): Promise<void> {
    const provider: SubagentProvider | undefined = this.ctx.subagents.getProvider(connection)
    if (provider?.discoverHarness === undefined) return
    const timeout = AbortSignal.timeout(this.probeTimeoutMs)
    const bound = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    try {
      const capabilities = await provider.discoverHarness({ signal: bound })
      this.probes.set(connection, {
        kind: 'answered',
        capabilities,
        discoveredAt: new Date().toISOString(),
      })
    } catch (error: unknown) {
      this.probes.set(connection, {
        kind: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * A configured connection with no registered provider: saved settings stay
 * visible, and the descriptor refuses to launch until the provider is mounted.
 * @param connection - configured provider name.
 * @returns a descriptor that advertises nothing but its absence.
 */
function missingConnection(connection: string): HarnessDescriptor {
  return {
    harness: connection,
    displayName: connection,
    connection,
    name: connection,
    state: 'not-installed',
    models: 'unknown',
    supportsAgentOptions: false,
    supportsContextFork: false,
    contextStrategies: [],
    source: 'registration',
    canProbe: false,
  }
}

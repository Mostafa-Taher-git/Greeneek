/**
 * Capability descriptors for the Harnesses a Fleet can name, and the pure
 * selection rule that refuses settings a Harness did not advertise.
 * A descriptor is derived from the live provider registry, never from a static
 * catalog: `unknown` is a first-class result, and `default` sends no override.
 * @module @greeneek/gnk-agent-team/harness-descriptor
 */

import type { HarnessCapabilities } from '@greeneek/gnk-subagent/client'
import type { FleetProviderState } from './fleet-settings.ts'

/** One reasoning-effort level a Harness advertises. */
export interface HarnessEffort {
  /** Invocation id sent to the Harness. */
  readonly id: string
  /** Display label; never used as an invocation id. */
  readonly name?: string
}

/** One model a Harness advertises. The id stays separate from its display name. */
export interface HarnessModel {
  /** Invocation id, as returned by model discovery. */
  readonly id: string
  /** Display label for the Settings selector. */
  readonly name?: string
  /** Discovery metadata shown beside the label. */
  readonly description?: string
  /** Advertised context-window size in tokens. */
  readonly contextWindow?: number
  /** Absent means the Harness did not advertise effort levels: unknown, not none. */
  readonly efforts?: readonly HarnessEffort[]
  /** The Harness's own default level. Greeneek never sends it as an override. */
  readonly defaultEffort?: string
}

/**
 * The structural part of a registered `SubagentProvider` this module reads.
 * Declaring the view locally keeps the descriptor derivation independent of the
 * service-definition package's published type surface.
 */
export interface RegisteredProviderView {
  /** Registry name of the provider — the Connection identity. */
  readonly name: string
  /** Start-time capability flags; `agentOptions` gates model and effort overrides. */
  readonly capabilities: { readonly agentOptions: boolean }
  /** Whether the child inherits the parent's completed-turn prefix. */
  readonly inheritsParentContext: boolean
  /** Provider-owned static route, when one exists. */
  readonly agentRouteDefaults?: Readonly<{ provider: string; model: string }>
  /** Method presence marks a provider that can hold a durable lane. */
  readonly prepareContinuable?: unknown
  /** Registration-time advertisement, when the provider publishes one. */
  readonly harnessCapabilities?: HarnessCapabilities
  /** Live discovery surface, when the provider can probe its Harness. */
  readonly discoverHarness?: unknown
}

/** One successful probe result. */
export interface HarnessDiscoverySnapshot {
  /** What the Harness advertised. */
  readonly capabilities: HarnessCapabilities
  /** When the probe answered, ISO 8601. */
  readonly discoveredAt: string
}

/** What one registered Harness advertises about itself. */
export interface HarnessDescriptor {
  /** Implementation identity shared by every connection of the product. */
  readonly harness: string
  /** Product display name. */
  readonly displayName: string
  /** Registry name of the provider — the Connection identity. */
  readonly connection: string
  /** Registry name (alias of `connection` for existing consumers). */
  readonly name: string
  /** Honest availability state. Discovery, not registration, owns the non-ready states. */
  readonly state: FleetProviderState
  /** Advertised models, or `unknown` when the Harness exposes no discovery surface. */
  readonly models: readonly HarnessModel[] | 'unknown'
  /** Whether this Harness accepts model and reasoning-effort overrides at start time. */
  readonly supportsAgentOptions: boolean
  /** Whether this Harness can seed a child from the parent's completed turns. */
  readonly supportsContextFork: boolean
  /** Fleet context strategies: `fresh` always, `fork` only when seeding is supported. */
  readonly contextStrategies: readonly ('fresh' | 'fork')[]
  /** Authentication methods the Harness advertised, when known. */
  readonly authMethods?: readonly { readonly id: string; readonly name?: string; readonly description?: string }[]
  /** Session capabilities the Harness advertised, when known. */
  readonly sessions?: {
    readonly new: boolean
    readonly load?: boolean
    readonly resume?: boolean
    readonly fork?: boolean
    readonly list?: boolean
    readonly delete?: boolean
  }
  /** Prompt capabilities the Harness advertised, when known. */
  readonly prompt?: { readonly image: boolean; readonly audio: boolean; readonly embeddedContext: boolean }
  /** Permission modes the Harness advertised, when known. */
  readonly permissions?: readonly { readonly id: string; readonly name?: string; readonly description?: string }[]
  /** Harness product version, when advertised. */
  readonly version?: string
  /** How these facts were learned. */
  readonly source: 'registration' | 'configuration' | 'acp-initialize' | 'acp-session'
  /** Whether the provider can be probed live. */
  readonly canProbe: boolean
  /** When the last probe answered, ISO 8601. */
  readonly discoveredAt?: string
  /** What the last probe failed with, when it failed. */
  readonly discoveryError?: string
}

/** The settings one Fleet member asks a Harness to run. */
export interface HarnessSelectionRequest {
  /** Requested model id, `default`, or absent for the Harness's own choice. */
  readonly model?: string
  /** Requested reasoning-effort id, `default`, or absent. */
  readonly reasoningEffort?: string
  /** Requested context strategy; `fork` requires a Harness that can seed parent turns. */
  readonly context?: 'fresh' | 'fork'
}

/** Codes that name why a Harness cannot run a requested setting. */
export type HarnessRefusalCode =
  | 'HARNESS_UNAVAILABLE'
  | 'HARNESS_AGENT_OPTIONS_UNSUPPORTED'
  | 'HARNESS_CONTEXT_NOT_SUPPORTED'
  | 'HARNESS_MODEL_NOT_ADVERTISED'
  | 'HARNESS_EFFORT_NOT_SUPPORTED'

/** The outcome of resolving one member's settings against one Harness. */
export type HarnessSelectionResult =
  | {
    /** The settings are usable. */
    readonly kind: 'selected'
    /** Canonical model id, or absent when the Harness keeps its own default. */
    readonly model?: string
    /** Canonical effort id, or absent when no override is sent. */
    readonly reasoningEffort?: string
    /** True when the Harness did not advertise enough metadata to verify the values. */
    readonly unverified: boolean
  }
  | {
    /** The settings must be refused by name, never silently ignored. */
    readonly kind: 'refused'
    /** Stable code for the refusal. */
    readonly code: HarnessRefusalCode
    /** Host-side reason naming the Harness, the requested value, and what is available. */
    readonly reason: string
  }

/** Availability states under which launching a Fleet member is refused. */
const UNAVAILABLE_STATES: readonly FleetProviderState[] = [
  'not-installed',
  'unauthenticated',
  'temporarily-unavailable',
]

/** The sentinel that asks a Harness to choose its own model or effort. */
export const HARNESS_DEFAULT = 'default'

/**
 * Classify one probe failure into the availability state it proves.
 * @param message - the probe error message.
 * @returns the honest state.
 */
function stateFromDiscoveryError(message: string): FleetProviderState {
  const normalized = message.toLocaleLowerCase()
  if (normalized.includes('401') || normalized.includes('unauthorized') || normalized.includes('invalid api key') || normalized.includes('authentication')) return 'unauthenticated'
  if (normalized.includes('enoent') || normalized.includes('not found') || normalized.includes('cannot find module')) return 'not-installed'
  return 'temporarily-unavailable'
}

/**
 * Identity of one connection: implementation id and product name, from the
 * winning capability set (live discovery over the registration advertisement)
 * when present, else the registry name.
 * @param provider - structural view of one registered provider.
 * @param discovery - the latest probe snapshot, when one answered.
 * @returns the Harness identity.
 */
function harnessIdentity(
  provider: RegisteredProviderView,
  discovery: HarnessDiscoverySnapshot | undefined,
): { id: string; displayName: string } {
  const advertised = advertisedCapabilities(provider, discovery)
  return {
    id: advertised?.id ?? provider.name,
    displayName: advertised?.displayName ?? advertised?.id ?? provider.name,
  }
}

/**
 * Capabilities to surface: live discovery wins over the registration
 * advertisement, which wins over the static route.
 * @param provider - structural view of one registered provider.
 * @param discovery - the latest probe snapshot, when one answered.
 * @returns the winning capability set, or undefined.
 */
function advertisedCapabilities(
  provider: RegisteredProviderView,
  discovery: HarnessDiscoverySnapshot | undefined,
): HarnessCapabilities | undefined {
  return discovery?.capabilities ?? provider.harnessCapabilities
}

/**
 * Derive an honest descriptor from a registered provider, advertising only the
 * capabilities that provider actually implements.
 * @param provider - structural view of one registered provider.
 * @param discovery - the latest probe snapshot, when one answered.
 * @param discoveryError - the last probe failure message, when it failed.
 * @returns a descriptor whose `models` is `unknown` unless the provider publishes a static route.
 */
export function harnessDescriptorFromProvider(
  provider: RegisteredProviderView,
  discovery?: HarnessDiscoverySnapshot,
  discoveryError?: string,
): HarnessDescriptor {
  const identity = harnessIdentity(provider, discovery)
  const advertised = advertisedCapabilities(provider, discovery)
  const route = provider.agentRouteDefaults
  const models: readonly HarnessModel[] | 'unknown' = advertised !== undefined
    ? advertised.models
    : route === undefined ? 'unknown' : [{ id: route.model }]
  const registeredState: FleetProviderState = provider.prepareContinuable === undefined ? 'one-shot' : 'ready'
  // Context seeding is an execution fact about the registered provider: an
  // advertisement cannot grant a launch the provider would not perform.
  const contextStrategies: readonly ('fresh' | 'fork')[] = provider.inheritsParentContext
    ? ['fresh', 'fork']
    : ['fresh']
  return {
    harness: identity.id,
    displayName: identity.displayName,
    connection: provider.name,
    name: provider.name,
    state: discoveryError === undefined ? registeredState : stateFromDiscoveryError(discoveryError),
    models,
    supportsAgentOptions: advertised?.supportsAgentOptions ?? provider.capabilities.agentOptions,
    supportsContextFork: provider.inheritsParentContext,
    contextStrategies,
    ...advertised?.authMethods === undefined ? {} : { authMethods: advertised.authMethods },
    ...advertised?.sessions === undefined ? {} : { sessions: advertised.sessions },
    ...advertised?.prompt === undefined ? {} : { prompt: advertised.prompt },
    ...advertised?.permissions === undefined ? {} : { permissions: advertised.permissions },
    ...advertised?.version === undefined ? {} : { version: advertised.version },
    source: advertised?.source ?? 'registration',
    canProbe: provider.discoverHarness !== undefined,
    ...discovery === undefined ? {} : { discoveredAt: discovery.discoveredAt },
    ...discoveryError === undefined ? {} : { discoveryError },
  }
}

/**
 * Resolve one member's model and effort against what a Harness advertises.
 * `default` and absent values send no override; `unknown` catalogs keep literal
 * ids and report `unverified` instead of inventing a refusal or a catalog.
 * @param descriptor - the Harness's advertised capabilities, or undefined when none is known.
 * @param request - the model and effort a Fleet member asked for.
 * @returns a canonical selection, or a named refusal.
 */
export function resolveHarnessSelection(
  descriptor: HarnessDescriptor | undefined,
  request: HarnessSelectionRequest,
): HarnessSelectionResult {
  const askedModel = request.model
  const askedEffort = request.reasoningEffort
  const asksOverride = (askedModel !== undefined && askedModel !== HARNESS_DEFAULT)
    || (askedEffort !== undefined && askedEffort !== HARNESS_DEFAULT)

  if (descriptor === undefined) {
    return {
      kind: 'selected',
      ...askedModel === undefined || askedModel === HARNESS_DEFAULT ? {} : { model: askedModel },
      ...askedEffort === undefined || askedEffort === HARNESS_DEFAULT ? {} : { reasoningEffort: askedEffort },
      unverified: true,
    }
  }
  if (UNAVAILABLE_STATES.includes(descriptor.state)) {
    return {
      kind: 'refused',
      code: 'HARNESS_UNAVAILABLE',
      reason: `harness "${descriptor.connection}" is ${descriptor.state}; refusing to launch a Fleet member`,
    }
  }
  if (asksOverride && !descriptor.supportsAgentOptions) {
    return {
      kind: 'refused',
      code: 'HARNESS_AGENT_OPTIONS_UNSUPPORTED',
      reason: `harness "${descriptor.connection}" does not support model or effort overrides`,
    }
  }
  if (request.context === 'fork' && !descriptor.supportsContextFork) {
    return {
      kind: 'refused',
      code: 'HARNESS_CONTEXT_NOT_SUPPORTED',
      reason: `harness "${descriptor.connection}" cannot seed a child from parent turns; use a fresh context`,
    }
  }

  let model: string | undefined
  let effort: string | undefined
  let unverified = false

  if (askedModel === undefined || askedModel === HARNESS_DEFAULT) {
    unverified = askedEffort !== undefined && askedEffort !== HARNESS_DEFAULT
  } else if (descriptor.models === 'unknown') {
    model = askedModel
    unverified = true
  } else {
    const advertised = descriptor.models.find(candidate => candidate.id === askedModel)
    if (advertised === undefined) {
      return {
        kind: 'refused',
        code: 'HARNESS_MODEL_NOT_ADVERTISED',
        reason: `harness "${descriptor.connection}" does not advertise model "${askedModel}"; available: ${descriptor.models.map(candidate => candidate.id).join(', ') || '(none)'}`,
      }
    }
    model = advertised.id
  }

  if (askedEffort === undefined || askedEffort === HARNESS_DEFAULT) {
    // Default sends no override; the Harness keeps its own level.
  } else if (descriptor.models === 'unknown' || model === undefined) {
    effort = askedEffort
    unverified = true
  } else {
    const advertised = descriptor.models.find(candidate => candidate.id === model)
    const efforts = advertised?.efforts
    if (efforts === undefined) {
      effort = askedEffort
      unverified = true
    } else {
      const level = efforts.find(candidate => candidate.id === askedEffort)
      if (level === undefined) {
        return {
          kind: 'refused',
          code: 'HARNESS_EFFORT_NOT_SUPPORTED',
          reason: `harness "${descriptor.connection}" model "${model}" does not support effort "${askedEffort}"; available: ${efforts.map(candidate => candidate.id).join(', ') || '(none)'}`,
        }
      }
      effort = level.id
    }
  }

  return {
    kind: 'selected',
    ...model === undefined ? {} : { model },
    ...effort === undefined ? {} : { reasoningEffort: effort },
    unverified,
  }
}

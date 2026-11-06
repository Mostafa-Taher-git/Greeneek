/**
 * Capability descriptors for the Harnesses a Fleet can name, and the pure
 * selection rule that refuses settings a Harness did not advertise.
 * A descriptor is derived from the live provider registry, never from a static
 * catalog: `unknown` is a first-class result, and `default` sends no override.
 * @module @greeneek/gnk-agent-team/harness-descriptor
 */

import type { FleetProviderState } from './fleet-settings.ts'

/** One reasoning-effort level a Harness advertises for one model. */
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
  /** Registry name of the provider. */
  readonly name: string
  /** Start-time capability flags; `agentOptions` gates model and effort overrides. */
  readonly capabilities: { readonly agentOptions: boolean }
  /** Whether the child inherits the parent's completed-turn prefix. */
  readonly inheritsParentContext: boolean
  /** Provider-owned static route, when one exists. */
  readonly agentRouteDefaults?: Readonly<{ provider: string; model: string }>
  /** Method presence marks a provider that can hold a durable lane. */
  readonly prepareContinuable?: unknown
}

/** What one registered Harness advertises about itself. */
export interface HarnessDescriptor {
  /** Registry name of the Harness. Two connections of one Harness share this name. */
  readonly name: string
  /** Optional named connection identity (for example `work` or `personal`). */
  readonly connection?: string
  /** Honest availability state. Discovery, not registration, owns the non-ready states. */
  readonly state: FleetProviderState
  /** Advertised models, or `unknown` when the Harness exposes no discovery surface. */
  readonly models: readonly HarnessModel[] | 'unknown'
  /** Whether this Harness accepts model and reasoning-effort overrides at start time. */
  readonly supportsAgentOptions: boolean
  /** Whether this Harness can seed a child from the parent's completed turns. */
  readonly supportsContextFork: boolean
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
 * Derive an honest descriptor from a registered provider, advertising only the
 * capabilities that provider actually implements.
 * @param provider - structural view of one registered `SubagentProvider`.
 * @returns a descriptor whose `models` is `unknown` unless the provider publishes a static route.
 */
export function harnessDescriptorFromProvider(provider: RegisteredProviderView): HarnessDescriptor {
  const route = provider.agentRouteDefaults
  return {
    name: provider.name,
    state: provider.prepareContinuable === undefined ? 'one-shot' : 'ready',
    models: route === undefined ? 'unknown' : [{ id: route.model }],
    supportsAgentOptions: provider.capabilities.agentOptions,
    supportsContextFork: provider.inheritsParentContext,
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
      reason: `harness "${descriptor.name}" is ${descriptor.state}; refusing to launch a Fleet member`,
    }
  }
  if (asksOverride && !descriptor.supportsAgentOptions) {
    return {
      kind: 'refused',
      code: 'HARNESS_AGENT_OPTIONS_UNSUPPORTED',
      reason: `harness "${descriptor.name}" does not support model or effort overrides`,
    }
  }
  if (request.context === 'fork' && !descriptor.supportsContextFork) {
    return {
      kind: 'refused',
      code: 'HARNESS_CONTEXT_NOT_SUPPORTED',
      reason: `harness "${descriptor.name}" cannot seed a child from parent turns; use a fresh context`,
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
        reason: `harness "${descriptor.name}" does not advertise model "${askedModel}"; available: ${descriptor.models.map(candidate => candidate.id).join(', ') || '(none)'}`,
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
          reason: `harness "${descriptor.name}" model "${model}" does not support effort "${askedEffort}"; available: ${efforts.map(candidate => candidate.id).join(', ') || '(none)'}`,
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

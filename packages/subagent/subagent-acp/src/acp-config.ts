/**
 * Pure mapping between ACP session configuration options and the Harness
 * capability contract. Keeping it free of process and RPC code lets the
 * discovery probe, the execution path, and unit tests share one interpretation
 * of what a child advertised.
 *
 * @module @greeneek/gnk-subagent-acp/acp-config
 */

import type {
  InitializeResponse,
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectOptions,
  SetSessionConfigOptionRequest,
} from '@agentclientprotocol/sdk'
import type {
  HarnessAuthMethod,
  HarnessCapabilities,
  HarnessEffortLevel,
  HarnessModelInfo,
  HarnessPermissionMode,
} from '@greeneek/gnk-subagent'

/** One select option, flattened out of a flat or grouped ACP option list. */
export interface AcpSelectOption {
  /** Value id the Harness accepts. */
  readonly value: string
  /** Display label. */
  readonly name: string
  /** Optional discovery detail. */
  readonly description?: string
}

/**
 * Flatten a select option list, which ACP may return flat or grouped.
 * @param options - the advertised flat or grouped option list.
 * @returns one entry per selectable value.
 */
export function acpSelectOptions(options: SessionConfigSelectOptions): AcpSelectOption[] {
  const flattened: AcpSelectOption[] = []
  for (const option of options) {
    if ('value' in option) {
      flattened.push({
        value: option.value,
        name: option.name,
        ...option.description === null || option.description === undefined
          ? {}
          : { description: option.description },
      })
    } else {
      for (const grouped of option.options) {
        flattened.push({
          value: grouped.value,
          name: grouped.name,
          ...grouped.description === null || grouped.description === undefined
            ? {}
            : { description: grouped.description },
        })
      }
    }
  }
  return flattened
}

/**
 * Find the advertised select option for one semantic category.
 * @param configOptions - options returned by `session/new`.
 * @param category - ACP's semantic category name.
 * @returns the matching select option, or undefined when the Harness did not advertise it.
 */
export function acpConfigOption(
  configOptions: readonly SessionConfigOption[] | null | undefined,
  category: string,
): Extract<SessionConfigOption, { type: 'select' }> | undefined {
  return configOptions?.find(
    (option): option is Extract<SessionConfigOption, { type: 'select' }> =>
      option.type === 'select' && option.category === category,
  )
}

/**
 * Map ACP's initialization and session responses onto the shared Harness
 * capability contract.
 * @param initialize - the child's `initialize` response.
 * @param session - the child's `session/new` response.
 * @param identity - implementation id and display name.
 * @returns a descriptor containing only what the child advertised.
 */
export function harnessCapabilitiesFromAcp(
  initialize: InitializeResponse,
  session: NewSessionResponse,
  identity: { readonly harnessId: string; readonly displayName?: string },
): HarnessCapabilities {
  const capabilities = initialize.agentCapabilities
  const modelOption = acpConfigOption(session.configOptions, 'model')
  const effortOption = acpConfigOption(session.configOptions, 'thought_level')
  const modeOption = acpConfigOption(session.configOptions, 'mode')

  const efforts: HarnessEffortLevel[] | undefined = effortOption === undefined
    ? undefined
    : acpSelectOptions(effortOption.options).map(option => ({
      id: option.value,
      name: option.name,
      ...option.description === undefined ? {} : { description: option.description },
    }))
  const models: HarnessModelInfo[] | 'unknown' = modelOption === undefined
    ? 'unknown'
    : acpSelectOptions(modelOption.options).map(option => ({
      id: option.value,
      name: option.name,
      ...option.description === undefined ? {} : { description: option.description },
      ...efforts === undefined ? {} : { efforts },
      ...effortOption === undefined ? {} : { defaultEffort: effortOption.currentValue },
    }))

  const authMethods: HarnessAuthMethod[] | undefined = initialize.authMethods === undefined
    ? undefined
    : initialize.authMethods.map((method) => {
      const description = 'description' in method ? method.description : undefined
      return {
        id: method.id,
        name: method.name,
        ...description === null || description === undefined ? {} : { description },
      }
    })

  const permissionModes: HarnessPermissionMode[] = []
  for (const mode of session.modes?.availableModes ?? []) {
    permissionModes.push({
      id: mode.id,
      name: mode.name,
      ...mode.description === null || mode.description === undefined
        ? {}
        : { description: mode.description },
    })
  }
  if (modeOption !== undefined) {
    for (const option of acpSelectOptions(modeOption.options)) {
      if (!permissionModes.some(candidate => candidate.id === option.value)) {
        permissionModes.push({
          id: option.value,
          name: option.name,
          ...option.description === undefined ? {} : { description: option.description },
        })
      }
    }
  }

  const sessionCapabilities = capabilities?.sessionCapabilities
  const promptCapabilities = capabilities?.promptCapabilities

  return {
    id: identity.harnessId,
    ...identity.displayName === undefined ? {} : { displayName: identity.displayName },
    models,
    supportsAgentOptions: modelOption !== undefined || effortOption !== undefined,
    // A Fleet context override means seeding a child from the parent's turns.
    // An ACP child cannot receive them, so the strategy stays `fresh` even when
    // the Harness advertises its own protocol-level `session/fork` below.
    contextStrategies: ['fresh'],
    ...authMethods === undefined ? {} : { authMethods },
    sessions: {
      new: true,
      load: capabilities?.loadSession === true,
      resume: sessionCapabilities?.resume !== undefined && sessionCapabilities.resume !== null,
      fork: sessionCapabilities?.fork !== undefined && sessionCapabilities.fork !== null,
      list: sessionCapabilities?.list !== undefined && sessionCapabilities.list !== null,
      delete: sessionCapabilities?.delete !== undefined && sessionCapabilities.delete !== null,
    },
    prompt: {
      image: promptCapabilities?.image === true,
      audio: promptCapabilities?.audio === true,
      embeddedContext: promptCapabilities?.embeddedContext === true,
    },
    ...permissionModes.length === 0 ? {} : { permissions: permissionModes },
    source: 'acp-session',
  }
}

/** One configuration option the client will set before prompting. */
export interface AcpSelection {
  /** Option id. */
  readonly configId: string
  /** Selected value id. */
  readonly value: string
}

/** The outcome of resolving requested model and effort against the advertised options. */
export type AcpSelectionPlan =
  | { readonly kind: 'selected'; readonly selections: readonly AcpSelection[] }
  | { readonly kind: 'unsupported'; readonly reason: string }

/**
 * Resolve requested model and effort ids against the options the child
 * advertised. A setting the child did not advertise is refused by name; the
 * caller must never silently drop it and run on the child's own default.
 * @param configOptions - options returned by `session/new`.
 * @param options - requested model and reasoning effort.
 * @returns the exact options to set, or a named refusal.
 */
export function planAcpSelections(
  configOptions: readonly SessionConfigOption[] | null | undefined,
  options: { readonly model?: string; readonly reasoningEffort?: string } | undefined,
): AcpSelectionPlan {
  const selections: AcpSelection[] = []
  if (options?.model !== undefined) {
    const modelOption = acpConfigOption(configOptions, 'model')
    if (modelOption === undefined) {
      return {
        kind: 'unsupported',
        reason: 'the ACP Harness does not advertise model selection',
      }
    }
    const available = acpSelectOptions(modelOption.options)
    if (!available.some(option => option.value === options.model)) {
      return {
        kind: 'unsupported',
        reason: `the ACP Harness does not advertise model "${options.model}"; available: ${available.map(option => option.value).join(', ') || '(none)'}`,
      }
    }
    selections.push({ configId: modelOption.id, value: options.model })
  }
  if (options?.reasoningEffort !== undefined) {
    const effortOption = acpConfigOption(configOptions, 'thought_level')
    if (effortOption === undefined) {
      return {
        kind: 'unsupported',
        reason: 'the ACP Harness does not advertise reasoning-effort selection',
      }
    }
    const available = acpSelectOptions(effortOption.options)
    if (!available.some(option => option.value === options.reasoningEffort)) {
      return {
        kind: 'unsupported',
        reason: `the ACP Harness does not advertise reasoning effort "${options.reasoningEffort}"; available: ${available.map(option => option.value).join(', ') || '(none)'}`,
      }
    }
    selections.push({ configId: effortOption.id, value: options.reasoningEffort })
  }
  return { kind: 'selected', selections }
}

/**
 * Build the wire request for one resolved selection.
 * @param sessionId - the created ACP session.
 * @param selection - option id and value id.
 * @returns the exact `session/set_config_option` request.
 */
export function acpSelectionRequest(
  sessionId: string,
  selection: AcpSelection,
): SetSessionConfigOptionRequest {
  return {
    sessionId,
    configId: selection.configId,
    value: selection.value,
  }
}

/**
 * Client-safe Harness capability vocabulary: no host imports, so browser faces
 * can describe what a Harness advertises without loading the provider runtime.
 *
 * @module @greeneek/gnk-subagent/harness-types
 */

/**
 * One reasoning-effort level a Harness advertises for one model.
 */
export interface HarnessEffortLevel {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

/**
 * One model a Harness advertises.
 */
export interface HarnessModelInfo {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly efforts?: readonly HarnessEffortLevel[]
  readonly defaultEffort?: string
  readonly variants?: readonly string[]
}

/**
 * One authentication method a Harness advertises.
 */
export interface HarnessAuthMethod {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

/**
 * Session capabilities a Harness advertises.
 */
export interface HarnessSessionCapabilities {
  readonly new: boolean
  readonly load?: boolean
  readonly resume?: boolean
  readonly fork?: boolean
  readonly list?: boolean
  readonly delete?: boolean
}

/**
 * Prompt capabilities a Harness advertises.
 */
export interface HarnessPromptCapabilities {
  readonly image: boolean
  readonly audio: boolean
  readonly embeddedContext: boolean
}

/**
 * One permission mode a Harness advertises.
 */
export interface HarnessPermissionMode {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

/**
 * The full capability advertisement of one Harness (one connection).
 */
export interface HarnessCapabilities {
  readonly id: string
  readonly displayName?: string
  readonly models: readonly HarnessModelInfo[] | 'unknown'
  readonly supportsAgentOptions: boolean
  readonly contextStrategies: readonly ('fresh' | 'fork')[]
  readonly authMethods?: readonly HarnessAuthMethod[]
  readonly sessions?: HarnessSessionCapabilities
  readonly prompt?: HarnessPromptCapabilities
  readonly permissions?: readonly HarnessPermissionMode[]
  readonly source: 'registration' | 'configuration' | 'acp-initialize' | 'acp-session'
  readonly version?: string
}

/**
 * A request to discover one Harness's capabilities.
 */
export interface HarnessDiscoveryRequest {
  readonly signal?: AbortSignal
}

/**
 * A provider that can discover its capabilities live.
 */
export type HarnessDiscovery = (request: HarnessDiscoveryRequest) => Promise<HarnessCapabilities>

/**
 * Browser-safe subagent projection and control vocabulary.
 *
 * @module @greeneek/gnk-subagent/client
 */

export type * from './control-types.ts'
export type { SubagentIdentityProjection, SubagentTimingProjection } from './projection-types.ts'
export type {
  HarnessAuthMethod,
  HarnessCapabilities,
  HarnessDiscovery,
  HarnessDiscoveryRequest,
  HarnessEffortLevel,
  HarnessModelInfo,
  HarnessPermissionMode,
  HarnessPromptCapabilities,
  HarnessSessionCapabilities,
} from './harness-types.ts'

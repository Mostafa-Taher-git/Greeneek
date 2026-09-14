/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@greeneek/cordis'
import agentPresetsRemote from '@greeneek/gnk-agent-presets/remote'
import commandsRemote from '@greeneek/gnk-commands/remote'
import authorizationControllerRemote from '@greeneek/gnk-api-authorization-controller/remote'
import settingsControllerRemote from '@greeneek/gnk-api-settings-controller/remote'
import goalsRemote from '@greeneek/gnk-goal/remote'
import llmRemote from '@greeneek/gnk-llm/remote'
import dynamicRemote from '@greeneek/gnk-cordis-host-runner/remote'
import pluginInventoryRemote from '@greeneek/gnk-host-plugin-inventory/remote'
import messageFeedbackRemote from '@greeneek/gnk-message-feedback/remote'
import sessionReferencesRemote from '@greeneek/gnk-session-reference/remote'
import subagentsRemote from '@greeneek/gnk-subagent/remote'
import sessionRemote from '@greeneek/gnk-api-session-controller/remote'
import workspaceRemote from '@greeneek/gnk-api-workspace-controller/remote'
import type { ClientRemote } from '@greeneek/gnk-api-gateway/client'

export type { ClientRemote } from '@greeneek/gnk-api-gateway/client'
export type { PluginInventorySnapshot } from '@greeneek/gnk-host-plugin-inventory/types'
export type {} from '@greeneek/gnk-agent-presets/remote'
export type {} from '@greeneek/gnk-commands/remote'
export type {} from '@greeneek/gnk-api-authorization-controller/remote'
export type {} from '@greeneek/gnk-api-settings-controller/remote'
export type {} from '@greeneek/gnk-goal/remote'
export type {} from '@greeneek/gnk-llm/remote'
export type {} from '@greeneek/gnk-host-plugin-inventory/remote'
export type {} from '@greeneek/gnk-message-feedback/remote'
export type {} from '@greeneek/gnk-session-reference/remote'
export type {} from '@greeneek/gnk-subagent/remote'
export type * from '@greeneek/gnk-subagent/client'
export type {} from '@greeneek/gnk-api-session-controller/remote'
export type * from '@greeneek/gnk-api-session-controller/types'
export type {} from '@greeneek/gnk-api-workspace-controller/remote'
export type * from '@greeneek/gnk-api-workspace-controller/types'
export type * from '@greeneek/gnk-api-authorization-controller/types'
export type { SessionJob as JobView } from '@greeneek/gnk-api-session-controller/types'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@greeneek/gnk-commands/types'
export type {} from '@greeneek/gnk-cordis-host-runner/types'
export type {} from '@greeneek/gnk-credentials/types'
export type {} from '@greeneek/gnk-llm/types'
export type {} from '@greeneek/gnk-agent-presets/types'
export type {} from '@greeneek/gnk-settings/types'
export type {} from '@greeneek/gnk-user-approval/types'
export type {} from '@greeneek/gnk-user-questions/types'
export type {} from '@greeneek/gnk-api-session-controller/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ConnectionHandle, ConnectionSinks, ContentBlock,
  MessageId,
  RpcId, RpcRequest, RpcResponse, RpcResult, SessionId,
  StreamChunk,
} from '@greeneek/gnk-client-connection/client'
export type {} from '@greeneek/gnk-api-gateway/client'
export type {} from '@greeneek/gnk-cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
export type {
  ApprovalRequestId,
  CordisHalfState,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectMethodManifest,
  CordisInspectPlatform,
  CordisInspectProviderManifest,
  CordisInspectProviderView,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectQueryResolved,
  CordisInspectRequestId,
  CordisInspectResolveAck,
  CordisRunDiagnostic,
  CordisRunStatus,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunAttempt,
  DynamicCordisRunResponse,
  DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt,
  RequestRunOutcome,
} from '@greeneek/gnk-cordis-host-runner/types'
// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@greeneek/gnk-credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@greeneek/gnk-settings/types'
// Provider registry and discovery vocabulary for the llm namespace.
export type {
  LlmConfigurableProvider, LlmDiscoveredModel,
  LlmModelDiscoveryRequest, LlmProviderInfo,
} from '@greeneek/gnk-llm/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
export type { FileReferenceCandidate } from '@greeneek/gnk-file-reference/types'
export type { SessionReferenceMentionCandidate } from '@greeneek/gnk-session-reference/types'

// The Remote failure vocabulary, re-exported so business packages keep naming
// this assembly alone. Types only: a value export would make spec imports load
// this module's owner /remote artifacts; specs take RemoteError from
// gnk-client-test-runtime instead.
export type {
  RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteResult,
} from '@greeneek/gnk-typert-protocol'
export type { RemoteHostFacts } from '@greeneek/gnk-api-gateway/client'

declare module '@greeneek/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [
      agentPresetsRemote, commandsRemote, authorizationControllerRemote, settingsControllerRemote, goalsRemote, llmRemote, dynamicRemote,
      pluginInventoryRemote, messageFeedbackRemote, sessionReferencesRemote,
      subagentsRemote, sessionRemote, workspaceRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}

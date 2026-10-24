/**
 * Public vocabulary of the Craft bridge seam. Every state the bridge publishes
 * is one of the four values below; app-specific behavior lives in manifests,
 * not in code.
 * @module @greeneek/gnk-craft/types
 */

/** Published health of one Craft app installation. */
export type CraftAppState = 'not-installed' | 'app-installed-cli-missing' | 'ready' | 'running'

/** Provenance of one manifest fact. Unverified facts are not release guarantees. */
export interface CraftManifestSource {
  /** Human-readable source name. */
  readonly label: string
  /** Source URL. */
  readonly url: string
  /** Whether the pilot proved this fact against a real installation. */
  readonly verified: boolean
}

/** Launch commands documented for one app. Display/reference data, never shell-interpreted by the bridge. */
export interface CraftLaunchTemplates {
  /** Headless CLI invocation template. */
  readonly headless: string
  /** GUI invocation template used by "Launch Connected". */
  readonly connected: string
}

/** Attach-mode publication gate. Pilot manifests keep `enabled` false. */
export interface CraftAttachPolicy {
  /** Whether the app documents an authenticated attach channel at all. */
  readonly supported: boolean
  /** Whether this build may publish attach-mode tools. */
  readonly enabled: boolean
  /** Why the current state is what it is (required even when enabled). */
  readonly reason: string
}

/** Confined roots for one job. */
export interface CraftManifestRoots {
  /** Read root; the session workspace. */
  readonly read: 'workspace'
  /** Write root; the job's `out/` directory. */
  readonly write: 'job-out'
}

/** Recipe skill shipped with one app manifest. */
export interface CraftRecipeRef {
  /** Skill name exposed while an app session is active. */
  readonly name: string
  /** One-line routing description. */
  readonly description: string
  /** Package-relative markdown file. */
  readonly file: string
}

/** Headless protocol metadata. */
export interface CraftHeadlessSpec {
  /** JSON-RPC method (and app meta-tool) that lists callable tools. */
  readonly listMethod: string
  /** Tool names allowed to register from the advertised catalog. */
  readonly toolFilter: readonly string[]
  /** Tool names whose results carry artifact paths. */
  readonly artifactTools: readonly string[]
}

/**
 * One Craft app capability matrix. Manifests are data: the bridge validates
 * this shape strictly and refuses unknown fields so a typo cannot silently
 * weaken the security posture.
 */
export interface CraftAppManifest {
  /** Manifest format version. */
  readonly schemaVersion: 1
  /** Stable app id used in tool names. */
  readonly id: string
  /** Human-readable product name. */
  readonly displayName: string
  /** Additional accepted ids (for example the pre-rename `printcraft`). */
  readonly aliases: readonly string[]
  /** CLI executable stem; the platform suffix is added by the local provider. */
  readonly cliStem: string
  /** Whether this app can run a headless job. */
  readonly headlessSupported: boolean
  /** Minimum supported app version (semantic `x.y.z`). */
  readonly minVersion: string
  /** Attach-mode publication gate. */
  readonly attach: CraftAttachPolicy
  /** Launch templates. */
  readonly launch: CraftLaunchTemplates
  /** Confined roots. */
  readonly roots: CraftManifestRoots
  /** Cancellation mechanism. */
  readonly cancellation: 'child-process-kill'
  /** Command classes that need an approval card before execution. */
  readonly riskyCommandClasses: readonly string[]
  /** Manifest fact provenance. */
  readonly sources: readonly CraftManifestSource[]
  /** Recipe skill shipped with the app. */
  readonly recipe: CraftRecipeRef
  /** Headless protocol metadata. */
  readonly headless: CraftHeadlessSpec
}

/** Resolved roots for one job. */
export interface CraftRoots {
  /** Session workspace root. */
  readonly read: string
  /** Job output root (`<workspace>/out`). */
  readonly write: string
}

/** Health snapshot for one app. */
export interface CraftStatus {
  /** Canonical app id. */
  readonly app: string
  /** Human-readable product name. */
  readonly displayName: string
  /** Published state. */
  readonly state: CraftAppState
  /** Absolute CLI path when discovery found one. */
  readonly executable?: string
  /** Installed app version when discovery reported one. */
  readonly version?: string
  /** Actionable detail for a non-ready state. */
  readonly detail?: string
}

/** One callable tool advertised by an app's headless server. */
export interface CraftToolDescriptor {
  /** Raw tool name on the app wire. */
  readonly name: string
  /** Model-facing description. */
  readonly description: string
  /** Raw JSON Schema for the tool arguments. */
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** One app protocol result projected into the harness content vocabulary. */
export interface CraftCallResult {
  /** Ordered content blocks. */
  readonly content: readonly Readonly<Record<string, unknown>>[]
  /** Artifact paths exactly as reported by the app. */
  readonly artifacts?: readonly string[]
  /** Whether the app reported the call as failed. */
  readonly isError?: boolean
}

/** Transport seam: the only app-wire surface the rest of the bridge sees. */
export interface CraftTransport {
  /** Discover the app's callable tool catalog. */
  listTools(): Promise<readonly CraftToolDescriptor[]>
  /** Call one advertised tool. */
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: { readonly signal: AbortSignal },
  ): Promise<CraftCallResult>
  /** Release the app process. Idempotent. */
  close(): Promise<void>
}

/** One opened host connection. */
export interface CraftHostSession {
  /** App wire transport. */
  readonly transport: CraftTransport
  /** Release the process tree. */
  close(): Promise<void>
}

/** Discovery result from a host provider. */
export interface CraftDiscovery {
  /** Measured state. */
  readonly state: CraftAppState
  /** Absolute executable path when found. */
  readonly executable?: string
  /** Installed version when found. */
  readonly version?: string
  /** Actionable detail for a non-ready state. */
  readonly detail?: string
}

/** Input for one headless host open. */
export interface CraftHostOpenRequest {
  /** Resolved manifest. */
  readonly app: CraftAppManifest
  /** Validated workspace root. */
  readonly workspaceRoot: string
  /** Confined roots. */
  readonly roots: CraftRoots
  /** Per-launch control token. */
  readonly controlToken: string
  /** Cancellation for discovery and spawn. */
  readonly signal: AbortSignal
}

/** Host provider contract implemented by a platform adapter. */
export interface CraftHostProvider {
  /** Unique provider id. */
  readonly id: string
  /** Measure one app installation. */
  discover(app: CraftAppManifest, options: { readonly signal: AbortSignal }): Promise<CraftDiscovery>
  /** Spawn and handshake one headless session. */
  open(request: CraftHostOpenRequest): Promise<CraftHostSession>
  /** Spawn the GUI in connected mode (desktop hosts only). */
  launchConnected?(request: {
    readonly app: CraftAppManifest
    readonly workspaceRoot: string
    readonly roots: CraftRoots
  }): Promise<void>
}

/** One live session returned to consumers. */
export interface CraftSession {
  /** Unique session id. */
  readonly id: string
  /** Canonical app id. */
  readonly app: string
  /** Session mode. Only headless is published in the pilot. */
  readonly mode: 'headless'
  /** Confined roots. */
  readonly roots: CraftRoots
  /** Tool catalog captured at open. */
  readonly tools: readonly CraftToolDescriptor[]
  /** App wire transport. */
  readonly transport: CraftTransport
  /** Release the session. Idempotent. */
  close(): Promise<void>
}

/** Open request accepted by the service. */
export interface CraftOpenRequest {
  /** App id or alias. */
  readonly app: string
  /** Requested mode; omitted means headless. `attach` is gated and unavailable. */
  readonly mode?: 'headless' | 'attach'
  /** Session workspace root (absolute). */
  readonly workspaceRoot: string
  /** Cancellation for discovery and spawn. */
  readonly signal?: AbortSignal
}

/** Recipe content loaded from the package. */
export interface CraftRecipe {
  /** Skill name. */
  readonly name: string
  /** Routing description. */
  readonly description: string
  /** Markdown body. */
  readonly content: string
}

/** Service configuration. */
export interface CraftRuntimeConfig {
  /** Maximum concurrent sessions. Integer >= 1. */
  readonly maxActiveApps?: number
  /** Pin one host provider by id; omitted requires exactly one registered provider. */
  readonly provider?: string
}

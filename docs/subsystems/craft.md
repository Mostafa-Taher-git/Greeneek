# Craft


`@greeneek/gnk-craft` exposes one `ctx.craft` service: the manifest-backed catalog of ArtCraft-suite apps and their headless session lifecycle. The service owns manifests, provider selection, root validation, the per-launch control token, and the concurrency cap; a registered `CraftHostProvider` owns the platform wire, so discovery, open, and cancellation are testable without any Craft app installed.

Source: [`packages/craft/craft/src/types.ts`](../../packages/craft/craft/src/types.ts)

## `CraftAppManifest`

```ts type-equiv
/**
 * One Craft app capability matrix. Manifests are data: the bridge validates
 * this shape strictly and refuses unknown fields so a typo cannot silently
 * weaken the security posture.
 */
interface CraftAppManifest {
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
  /** Platforms the app documents; discovery on any other host reports not-installed. */
  readonly platforms: readonly CraftPlatform[]
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
  /** Whether recorded runs proved this app's capability matrix on the test host. */
  readonly verified: boolean
  /** Manifest fact provenance. */
  readonly sources: readonly CraftManifestSource[]
  /** Recipe skill shipped with the app. */
  readonly recipe: CraftRecipeRef
  /** Headless protocol metadata. */
  readonly headless: CraftHeadlessSpec
}
```

Every per-app behavior the bridge needs — launch commands, the attach gate, the curated headless tool filter, artifact tool names and output patterns, confined roots, documented platforms — lives in a manifest file, never in code. The loader validates the headless launch grammar at load: `{cli}` must open the template and the two roots plus the control-token file must appear, so a stale template fails before any spawn. The `sources` list records provenance per manifest entry, not per fact: the loader validates each entry's `label`, `url`, ISO `date`, and `verified` fields, and no other code reads them. A manifest may claim row-level `verified: true` only alongside at least one proven source entry; unverified entries are pilot placeholders, not release guarantees. The nested vocabulary (`CraftAttachPolicy`, `CraftLaunchTemplates`, `CraftManifestRoots`, `CraftManifestSource`, `CraftPlatform`, `CraftRecipeRef`, `CraftHeadlessSpec`) is declared in the same module.

## `CraftHostProvider`

```ts type-equiv
/** Host provider contract implemented by a platform adapter. */
interface CraftHostProvider {
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
```

One provider is registered per platform surface; the service selects the configured pin or requires exactly one registration. `discover` measures the installation, `open` spawns and handshakes one headless session, and optional `launchConnected` starts the GUI against the current workspace. In-memory fake providers are the entire CI strategy: no Craft app is ever installed on the test host.

## `CraftOpenRequest`

```ts type-equiv
/** Open request accepted by the service. */
interface CraftOpenRequest {
  /** App id or alias. */
  readonly app: string
  /** Requested mode; omitted means headless. `attach` is gated and unavailable. */
  readonly mode?: 'headless' | 'attach'
  /** Session workspace root (absolute). */
  readonly workspaceRoot: string
  /** Cancellation for discovery and spawn. */
  readonly signal?: AbortSignal
}
```

The service resolves the workspace root, derives the confined job roots, and mints the per-launch control token before any spawn; callers supply intent, not wires. `attach` throws in the pilot even for an attach-enabled manifest because the upstream authenticated control channel has not shipped.

## `CraftSession`

```ts type-equiv
/** One live session returned to consumers. */
interface CraftSession {
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
```

The tool catalog is captured once at open, so a mid-session `tools/list` change cannot rename a registered tool underneath the consumer. `transport` is the only app-wire surface consumers see; sessions are disposed with the owning context fiber and the concurrency cap (`maxActiveApps`, default 2) bounds live children.

## `CraftStatus`

```ts type-equiv
/** Health snapshot for one app. */
interface CraftStatus {
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
```

`state` is one of `not-installed`, `app-installed-cli-missing`, `ready`, or `running`; an active session always reports `running` without re-measuring. Discovery detail strings are machine-readable diagnostics that the browser settings section renders verbatim.

## `CraftRecipe`

```ts type-equiv
/** Recipe content loaded from the package. */
interface CraftRecipe {
  /** Skill name. */
  readonly name: string
  /** Routing description. */
  readonly description: string
  /** Markdown body. */
  readonly content: string
}
```

Each manifest ships one recipe markdown file. The Craft tool consumer registers it as a runtime skill only while that app's session is active, so recipe guidance enters the model context exactly between open and close.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcraft--craftruntime"></a>

### `ctx.craft` — `CraftRuntime`

Craft bridge service. One instance per context.

```ts cordis-catalog
/**
 * Register one host provider. Duplicate ids fail loud.
 * @param provider - platform adapter.
 * @returns the disposer that unregisters it.
 */
registerProvider(provider: CraftHostProvider): () => void

/**
 * Every pilot manifest in catalog order.
 * @returns the manifests, ordered as the catalog declares them.
 */
listApps(): readonly CraftAppManifest[]

/**
 * Resolve one app id or alias.
 * @param app - id or alias.
 * @returns the manifest.
 */
app(app: string): CraftAppManifest

/**
 * Whether attach mode may be published for an app.
 * @param app - id, alias, or manifest.
 * @returns `attach.supported && attach.enabled`.
 */
attachEnabled(app: string | CraftAppManifest): boolean

/**
 * Read one app's recipe.
 * @param app - id or alias.
 * @returns the recipe skill content.
 */
recipe(app: string): CraftRecipe

/**
 * Measure one app installation. An active session always reports `running`.
 * @param app - id or alias.
 * @param signal - cancellation for discovery.
 * @returns the published status.
 */
async status(app: string, signal: AbortSignal = new AbortController().signal): Promise<CraftStatus>

/**
 * Open one headless session.
 *
 * Order is security-significant: app resolution, attach gate, headless
 * capability, root validation, concurrency cap, provider selection, token
 * minting, then spawn and catalog discovery. A failed discovery closes the
 * freshly spawned process before the error escapes.
 * @param request - app, mode, workspace root, and cancellation.
 * @returns the live session.
 */
async open(request: CraftOpenRequest): Promise<CraftSession>

/**
 * Close one session by id.
 * @param id - session id returned by {@link open}.
 */
async closeSession(id: string): Promise<void>

/**
 * Close every live session. Failures are contained: teardown must not throw
 * out of a disposal path, and one stuck app must not strand the others.
 */
async closeAll(): Promise<void>
```

Source: [`packages/craft/craft/src/service.ts`](../../packages/craft/craft/src/service.ts)
<!-- END GENERATED cordis-surface -->

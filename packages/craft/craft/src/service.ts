/**
 * `ctx.craft`: the Craft app catalog and headless session lifecycle.
 *
 * The service owns manifests, provider selection, root validation, the
 * per-launch control token, and the concurrency cap. It never spawns a process
 * itself — a {@link CraftHostProvider} implementation owns the platform wire —
 * so discovery, open, and cancellation are testable without any Craft app.
 * Auto-detected apps (no hand-written manifest) are synthesized from launcher
 * facts and opened through the same path with an observed tool filter.
 * @module @greeneek/gnk-craft/service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import { buildCapabilityMatrix, CapabilityCache } from './capability.ts'
import { CraftError } from './error.ts'
import { CraftCatalog, loadPilotCatalog } from './manifest.ts'
import { craftRoots, resolveWorkspaceRoot } from './paths.ts'
import { hashCommandRegistry } from './registry.ts'
import { provisionalManifest, synthesizeManifest } from './synthesize.ts'
import type {
  CraftAppManifest,
  CraftDiscoveredApp,
  CraftHostProvider,
  CraftOpenRequest,
  CraftRecipe,
  CraftRuntimeConfig,
  CraftSession,
  CraftStatus,
} from './types.ts'

declare module '@greeneek/cordis' {
  interface Context {
    craft: CraftRuntime
  }
}

/** Default concurrent-session cap. */
export const DEFAULT_MAX_ACTIVE_APPS = 2

/** Service configuration schema. */
export const Config: z<CraftRuntimeConfig> = z.object({
  maxActiveApps: z.number().default(DEFAULT_MAX_ACTIVE_APPS),
  provider: z.string().default(''),
})

/**
 * Craft bridge service. One instance per context.
 */
export class CraftRuntime extends Service {
  static Config = Config

  private readonly catalog: CraftCatalog
  private readonly providers = new Map<string, CraftHostProvider>()
  private readonly sessions = new Map<string, CraftSession>()
  /** In-flight opens, reserved synchronously so the concurrency cap holds under concurrent `open()` calls. */
  private pendingOpens = 0
  private readonly observedRegistryHashes = new Map<string, string>()
  private readonly capabilityCache = new CapabilityCache()
  private readonly maxActiveApps: number
  private readonly pinnedProvider: string

  /**
   * @param ctx - owning context.
   * @param config - concurrency cap and optional provider pin.
   * @param catalog - manifest catalog; defaults to the bundled pilot.
   */
  constructor(
    ctx: Context,
    config: CraftRuntimeConfig = {},
    catalog: CraftCatalog = loadPilotCatalog(),
  ) {
    super(ctx, 'craft')
    const maxActiveApps = config.maxActiveApps ?? DEFAULT_MAX_ACTIVE_APPS
    if (!Number.isInteger(maxActiveApps) || maxActiveApps < 1) {
      throw new CraftError(
        `craft.maxActiveApps must be an integer greater than or equal to 1, got ${String(maxActiveApps)}`,
        'CRAFT_LIMIT_REACHED',
      )
    }
    this.maxActiveApps = maxActiveApps
    this.pinnedProvider = config.provider ?? ''
    this.catalog = catalog
    // Sessions own child processes; the fiber must never leak them.
    // `closeAll` contains every per-session failure, so it cannot reject.
    this.ctx.effect(() => () => {
      void this.closeAll()
    }, 'craft.sessions')
  }

  /**
   * Register one host provider. Duplicate ids fail loud.
   * @param provider - platform adapter.
   * @returns the disposer that unregisters it.
   */
  registerProvider(provider: CraftHostProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new CraftError(
        `a Craft host provider with id "${provider.id}" is already registered`,
        'CRAFT_PROVIDER_AMBIGUOUS',
      )
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous disposer
    return this.ctx.effect(() => {
      this.providers.set(provider.id, provider)
      // The fiber runs this disposer exactly once, so no stale-disposer
      // eviction of a re-registered successor is possible.
      return () => {
        this.providers.delete(provider.id)
      }
    }, 'craft.registerProvider()')
  }

  /**
   * Every pilot manifest in catalog order.
   * @returns the manifests, ordered as the catalog declares them.
   */
  listApps(): readonly CraftAppManifest[] {
    return this.catalog.apps()
  }

  /**
   * Resolve one app id or alias.
   * @param app - id or alias.
   * @returns the manifest.
   */
  app(app: string): CraftAppManifest {
    return this.catalog.require(app)
  }

  /**
   * Find one app id or alias without failing.
   * @param app - id or alias.
   * @returns the manifest, or undefined when it is not in the catalog.
   */
  findApp(app: string): CraftAppManifest | undefined {
    return this.catalog.find(app)
  }

  /**
   * Whether attach mode may be published for an app.
   * @param app - id, alias, or manifest.
   * @returns `attach.supported && attach.enabled`.
   */
  attachEnabled(app: string | CraftAppManifest): boolean {
    const manifest = typeof app === 'string' ? this.catalog.require(app) : app
    return manifest.attach.supported && manifest.attach.enabled
  }

  /**
   * Read one app's recipe.
   * @param app - id or alias.
   * @returns the recipe skill content.
   */
  recipe(app: string): CraftRecipe {
    return this.catalog.recipe(app)
  }

  /**
   * Every installed app the host reports, catalog and auto-detected alike.
   * Catalog apps keep their hand-written manifests; auto-detected ids are
   * synthesized from launcher facts without any hand-written adapter.
   * @param signal - cancellation for inventory.
   * @returns status per discovered app, plus every catalog app when no inventory exists.
   */
  async discoveredApps(signal: AbortSignal = new AbortController().signal): Promise<readonly CraftStatus[]> {
    const provider = this.selectProvider()
    let inventory: readonly CraftDiscoveredApp[] | undefined
    try {
      inventory = provider.listInstalled === undefined
        ? undefined
        : await provider.listInstalled({ signal })
    } catch {
      signal.throwIfAborted()
      inventory = undefined
    }
    const ids = new Set<string>()
    const statuses: CraftStatus[] = []
    for (const manifest of this.catalog.apps()) {
      ids.add(manifest.id)
      statuses.push(await this.status(manifest.id, signal))
    }
    if (inventory !== undefined) {
      for (const entry of inventory) {
        if (ids.has(entry.id)) continue
        ids.add(entry.id)
        statuses.push(await this.status(entry.id, signal))
      }
    }
    return statuses
  }

  /**
   * Last observed capability hash for one app.
   * @param app - id or alias.
   * @returns the hash, or undefined when never observed.
   */
  observedCapabilityHash(app: string): string | undefined {
    const manifest = this.catalog.find(app)
    return this.observedRegistryHashes.get(manifest?.id ?? app)
  }

  /**
   * Measure one app installation. An active session always reports `running`,
   * and a discovery error reports `failed` with its message instead of failing
   * the whole roster read. Caller cancellation still rejects.
   * @param app - id or alias.
   * @param signal - cancellation for discovery.
   * @returns the published status.
   */
  async status(app: string, signal: AbortSignal = new AbortController().signal): Promise<CraftStatus> {
    const { manifest } = await this.resolveManifest(app, signal)
    if (this.isRunning(manifest.id)) {
      return { app: manifest.id, displayName: manifest.displayName, state: 'running' }
    }
    const provider = this.selectProvider()
    try {
      const discovery = await provider.discover(manifest, { signal })
      if (discovery.state === 'ready') {
        const peer = this.driftBaseline(manifest)
        if (peer !== undefined) {
          return {
            app: manifest.id,
            displayName: manifest.displayName,
            ...discovery,
            state: 'drifted',
            detail: peer,
          }
        }
      }
      return { app: manifest.id, displayName: manifest.displayName, ...discovery }
    } catch (error: unknown) {
      signal.throwIfAborted()
      return {
        app: manifest.id,
        displayName: manifest.displayName,
        state: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

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
  async open(request: CraftOpenRequest): Promise<CraftSession> {
    const signal = request.signal ?? new AbortController().signal
    const { manifest: catalogOrProvisional, synthesized } = await this.resolveManifest(request.app, signal)
    const mode = request.mode ?? 'headless'
    if (mode === 'attach') {
      if (!this.attachEnabled(catalogOrProvisional)) {
        throw new CraftError(
          `attach mode is disabled for "${catalogOrProvisional.id}": ${catalogOrProvisional.attach.reason}`,
          'CRAFT_ATTACH_DISABLED',
        )
      }
      // Even an attach-enabled manifest cannot open a live GUI channel in the
      // pilot: the authenticated wire is explicitly out of scope until the
      // upstream channel ships.
      throw new CraftError(
        `attach mode for "${catalogOrProvisional.id}" is published but not implemented in the v0.3.4 pilot`,
        'CRAFT_ATTACH_DISABLED',
      )
    }
    if (!catalogOrProvisional.headlessSupported) {
      throw new CraftError(`"${catalogOrProvisional.id}" does not support headless jobs`, 'CRAFT_HEADLESS_UNSUPPORTED')
    }
    const workspaceRoot = resolveWorkspaceRoot(request.workspaceRoot)
    const roots = craftRoots(workspaceRoot)
    if (this.sessions.size + this.pendingOpens >= this.maxActiveApps) {
      throw new CraftError(
        `Craft session limit reached (${String(this.maxActiveApps)}); close an app before opening another`,
        'CRAFT_LIMIT_REACHED',
      )
    }
    this.selectProvider()
    this.pendingOpens += 1
    try {
      return await this.openInner(catalogOrProvisional, synthesized, workspaceRoot, roots, signal)
    } finally {
      this.pendingOpens -= 1
    }
  }

  /**
   * Open one session through the validated provider path.
   * @param manifest - catalog or provisional synthesized manifest.
   * @param synthesized - discovered entry when the manifest was synthesized.
   * @param workspaceRoot - validated workspace root.
   * @param roots - confined job roots.
   * @param signal - caller cancellation.
   * @returns the live session.
   */
  private async openInner(
    manifest: CraftAppManifest,
    synthesized: CraftDiscoveredApp | undefined,
    workspaceRoot: string,
    roots: { readonly read: string; readonly write: string },
    signal: AbortSignal,
  ): Promise<CraftSession> {
    const provider = this.selectProvider()
    const controlToken = randomUUID()
    const host = await provider.open({ app: manifest, workspaceRoot, roots, controlToken, signal })
    let tools: Awaited<ReturnType<typeof host.transport.listTools>>
    let effective = manifest
    let registryReviewed = false
    try {
      signal.throwIfAborted()
      if (manifest.headless.registryMethod !== null) {
        const raw = await host.transport.readCommandRegistry()
        const matrix = buildCapabilityMatrix(manifest.id, raw)
        this.observedRegistryHashes.set(manifest.id, matrix.hash)
        const drifted = this.capabilityCache.remember(manifest.id, matrix.hash)
        const trustedHash = manifest.headless.trustedRegistryHash
        if (trustedHash !== null && matrix.hash !== trustedHash) {
          throw new CraftError(registryDriftDetail(manifest, trustedHash, matrix.hash), 'CRAFT_APP_NOT_READY')
        }
        if (trustedHash === null && drifted) {
          throw new CraftError(
            registryDriftDetail(manifest, this.capabilityCache.baselineHash(manifest.id) as string, matrix.hash),
            'CRAFT_APP_NOT_READY',
          )
        }
        registryReviewed = matrix.hash === trustedHash
      }
      tools = await host.transport.listTools()
      if (synthesized !== undefined) {
        const matrix = buildCapabilityMatrix(manifest.id, { tools })
        this.observedRegistryHashes.set(manifest.id, matrix.hash)
        const drifted = this.capabilityCache.remember(manifest.id, matrix.hash)
        if (drifted) {
          throw new CraftError(
            registryDriftDetail(manifest, this.capabilityCache.baselineHash(manifest.id) as string, matrix.hash),
            'CRAFT_APP_NOT_READY',
          )
        }
        effective = synthesizeManifest(synthesized, tools)
        registryReviewed = false
      } else if (manifest.headless.registryMethod === null) {
        // MCP and serve fallback sessions cache their live catalog so a later
        // open can drift-hash against the first observation without ever
        // treating first use as a review.
        const hash = hashCommandRegistry({ tools })
        this.observedRegistryHashes.set(manifest.id, hash)
        this.capabilityCache.remember(manifest.id, hash)
      }
    } catch (error: unknown) {
      await host.close()
      throw error
    }
    const id = randomUUID()
    let closed = false
    const close = async (): Promise<void> => {
      if (closed) return
      closed = true
      this.sessions.delete(id)
      await host.close()
    }
    const session: CraftSession = {
      id,
      app: manifest.id,
      mode: 'headless',
      roots,
      tools,
      registryReviewed,
      manifest: effective,
      transport: host.transport,
      close,
    }
    this.sessions.set(id, session)
    return session
  }

  /**
   * Close one session by id.
   * @param id - session id returned by {@link open}.
   */
  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (session === undefined) {
      throw new CraftError(`unknown Craft session "${id}"`, 'CRAFT_SESSION_UNKNOWN')
    }
    await session.close()
  }

  /**
   * Close every live session. Failures are contained: teardown must not throw
   * out of a disposal path, and one stuck app must not strand the others.
   */
  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()]
    const results = await Promise.allSettled(sessions.map(session => session.close()))
    for (const result of results) {
      if (result.status === 'rejected') {
        this.ctx.logger.warn(`craft: failed to close a session: ${String(result.reason)}`)
      }
    }
  }

  /** Whether one canonical app id currently has a live session. */
  private isRunning(id: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.app === id) return true
    }
    return false
  }

  /**
   * Resolve one app id to its catalog manifest or a synthesized provisional.
   * @param app - id or alias.
   * @param signal - cancellation for inventory.
   * @returns the manifest and the discovered entry when synthesized.
   */
  private async resolveManifest(
    app: string,
    signal: AbortSignal,
  ): Promise<{ readonly manifest: CraftAppManifest; readonly synthesized: CraftDiscoveredApp | undefined }> {
    const known = this.catalog.find(app)
    if (known !== undefined) return { manifest: known, synthesized: undefined }
    const provider = this.selectProvider()
    if (provider.listInstalled !== undefined) {
      const inventory = await provider.listInstalled({ signal })
      const hit = inventory.find(entry => entry.id === app.trim().toLowerCase())
      if (hit !== undefined) return { manifest: provisionalManifest(hit), synthesized: hit }
    }
    return { manifest: this.catalog.require(app), synthesized: undefined }
  }

  /** Drift detail when the last observation disagrees with the baseline, else undefined. */
  private driftBaseline(manifest: CraftAppManifest): string | undefined {
    const observed = this.observedRegistryHashes.get(manifest.id)
    if (observed === undefined) return undefined
    const trusted = manifest.headless.trustedRegistryHash
    if (trusted !== null) {
      return observed === trusted ? undefined : registryDriftDetail(manifest, trusted, observed)
    }
    const baseline = this.capabilityCache.baselineHash(manifest.id)
    if (baseline !== undefined && observed !== baseline) {
      return registryDriftDetail(manifest, baseline, observed)
    }
    return undefined
  }

  /** Resolve exactly one provider (or the pinned one). */
  private selectProvider(): CraftHostProvider {
    if (this.pinnedProvider !== '') {
      const pinned = this.providers.get(this.pinnedProvider)
      if (pinned === undefined) {
        throw new CraftError(
          `configured Craft host provider "${this.pinnedProvider}" is not registered`,
          'CRAFT_NO_PROVIDER',
        )
      }
      return pinned
    }
    const providers = [...this.providers.values()]
    if (providers.length === 0) {
      throw new CraftError('no Craft host provider is registered', 'CRAFT_NO_PROVIDER')
    }
    if (providers.length > 1) {
      throw new CraftError(
        `multiple Craft host providers are registered (${providers.map(provider => provider.id).join(', ')}); configure one explicitly`,
        'CRAFT_PROVIDER_AMBIGUOUS',
      )
    }
    return providers[0] as CraftHostProvider
  }
}

/** Explain an observed registry mismatch without hiding either digest. */
function registryDriftDetail(app: CraftAppManifest, expected: string, observed: string): string {
  return `${app.displayName} command registry drifted (expected ${expected}, observed ${observed}); review it before use`
}

export default CraftRuntime

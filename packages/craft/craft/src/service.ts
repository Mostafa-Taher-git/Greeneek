/**
 * `ctx.craft`: the Craft app catalog and headless session lifecycle.
 *
 * The service owns manifests, provider selection, root validation, the
 * per-launch control token, and the concurrency cap. It never spawns a process
 * itself — a {@link CraftHostProvider} implementation owns the platform wire —
 * so discovery, open, and cancellation are testable without any Craft app.
 * @module @greeneek/gnk-craft/service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import { CraftError } from './error.ts'
import { CraftCatalog, loadPilotCatalog } from './manifest.ts'
import { craftRoots, resolveWorkspaceRoot } from './paths.ts'
import type {
  CraftAppManifest,
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
   * Measure one app installation. An active session always reports `running`.
   * @param app - id or alias.
   * @param signal - cancellation for discovery.
   * @returns the published status.
   */
  async status(app: string, signal: AbortSignal = new AbortController().signal): Promise<CraftStatus> {
    const manifest = this.catalog.require(app)
    if (this.isRunning(manifest.id)) {
      return { app: manifest.id, displayName: manifest.displayName, state: 'running' }
    }
    const provider = this.selectProvider()
    const discovery = await provider.discover(manifest, { signal })
    return { app: manifest.id, displayName: manifest.displayName, ...discovery }
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
    const manifest = this.catalog.require(request.app)
    const mode = request.mode ?? 'headless'
    if (mode === 'attach') {
      if (!this.attachEnabled(manifest)) {
        throw new CraftError(
          `attach mode is disabled for "${manifest.id}": ${manifest.attach.reason}`,
          'CRAFT_ATTACH_DISABLED',
        )
      }
      // Even an attach-enabled manifest cannot open a live GUI channel in the
      // pilot: the authenticated wire is explicitly out of scope until the
      // upstream channel ships.
      throw new CraftError(
        `attach mode for "${manifest.id}" is published but not implemented in the v0.3.4 pilot`,
        'CRAFT_ATTACH_DISABLED',
      )
    }
    if (!manifest.headlessSupported) {
      throw new CraftError(`"${manifest.id}" does not support headless jobs`, 'CRAFT_HEADLESS_UNSUPPORTED')
    }
    const workspaceRoot = resolveWorkspaceRoot(request.workspaceRoot)
    const roots = craftRoots(workspaceRoot)
    if (this.sessions.size >= this.maxActiveApps) {
      throw new CraftError(
        `Craft session limit reached (${String(this.maxActiveApps)}); close an app before opening another`,
        'CRAFT_LIMIT_REACHED',
      )
    }
    const provider = this.selectProvider()
    const signal = request.signal ?? new AbortController().signal
    const controlToken = randomUUID()
    const host = await provider.open({ app: manifest, workspaceRoot, roots, controlToken, signal })
    let tools
    try {
      signal.throwIfAborted()
      tools = await host.transport.listTools()
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

export default CraftRuntime

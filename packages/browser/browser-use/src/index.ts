/**
 * Service Definition for the browser-use capability seam (`ctx.browser`): a
 * single provider slot and one tracked navigation state per profile. The
 * service is the authority for agent and user driven navigation; the renderer
 * observes it through the forwarded `browser/surface` event.
 * @module @greeneek/gnk-browser-use
 */
import { Context, Service } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import { BrowserError } from './error.ts'
import type {
  BrowserBackend,
  BrowserBackendCloseSpec,
  BrowserBackendSpec,
  BrowserCloseRequest,
  BrowserContentBackend,
  BrowserContentSpec,
  BrowserErrorCode,
  BrowserLinkSelector,
  BrowserNavigateRequest,
  BrowserPageContent,
  BrowserProfile,
  BrowserSource,
  BrowserSurfaceSnapshot,
} from './types.ts'

export { BrowserError } from './error.ts'
export type {
  BrowserBackend, BrowserBackendCloseSpec, BrowserBackendSpec, BrowserCloseRequest,
  BrowserContentBackend, BrowserContentSpec, BrowserErrorCode, BrowserLinkSelector,
  BrowserNavigateRequest, BrowserPageContent, BrowserProfile,
  BrowserProviderProfile, BrowserSource, BrowserSurfaceSnapshot,
} from './types.ts'

declare module '@greeneek/cordis' {
  interface Context {
    /** Browser-use surface authority. */
    browser: BrowserSurfaceService
  }
}

/** Emitted whenever a tracked surface changes; forwarded to browser clients. */
export const BROWSER_SURFACE_EVENT = 'browser/surface'

/** Resolved limits for browser addresses and titles. */
export interface BrowserUseConfig {
  /** Maximum accepted URL length in characters. */
  readonly maxUrlLength: number
  /** Maximum reported title length in characters. */
  readonly maxTitleLength: number
  /** Maximum page text characters returned by one content read. */
  readonly maxContentChars: number
  /** Maximum number of links returned by one content read. */
  readonly maxLinks: number
}

/** Default limits, matching the client browser carrier. */
export const DEFAULT_BROWSER_USE_CONFIG: BrowserUseConfig = {
  maxUrlLength: 16 * 1024,
  maxTitleLength: 300,
  maxContentChars: 100_000,
  maxLinks: 100,
}

/** One tracked profile surface. */
interface SurfaceRecord {
  /** Current tracked URL. */
  url: string | undefined
  /** Exact owning Agent, when agent-driven. */
  owner: Agent | undefined
  /** Who last drove the surface. */
  source: BrowserSource
}

/** The browser-use service: one backend slot plus per-profile tracked state. */
export class BrowserSurfaceService extends Service {
  private backend: BrowserBackend | undefined
  private disposedFlag = false
  private readonly records = new Map<BrowserProfile, SurfaceRecord>()
  /** Owners whose fibers ended; their surfaces are released on teardown. */
  private readonly detached = new Map<Agent, () => void>()

  /** @param ctx - Host context. @param config - resolved operational limits. */
  constructor(ctx: Context, private readonly config: BrowserUseConfig = { ...DEFAULT_BROWSER_USE_CONFIG }) {
    super(ctx, 'browser')
    ctx.effect(() => () => {
      this.disposedFlag = true
      for (const detach of this.detached.values()) detach()
      this.detached.clear()
      this.records.clear()
      this.backend = undefined
    }, 'browser-use teardown')
  }

  /**
   * Register the single browser runtime provider. A second registration is
   * rejected, so provider selection never depends on activation order.
   * @param backend - the provider to install.
   * @returns disposer that removes exactly this provider.
   */
  registerBackend(backend: BrowserBackend): () => void {
    if (backend.type.length === 0) throw this.error('NO_BACKEND', 'browser backend type must not be empty')
    if (this.backend !== undefined) {
      throw this.error('DUPLICATE_BACKEND', `browser backend ${this.backend.type} is already registered`)
    }
    const ctx = this.ctx
    const fiber = ctx.effect(() => {
      this.backend = backend
      return () => {
        if (this.backend === backend) this.backend = undefined
      }
    }, `browser-use backend ${backend.type}`)
    return () => { void fiber() }
  }

  /** Resolve the installed provider or fail with a stable code. */
  private requireBackend(): BrowserBackend {
    if (this.disposedFlag) throw this.error('SERVICE_DISPOSING', 'browser-use service is disposing')
    if (this.backend === undefined) throw this.error('NO_BACKEND', 'no browser backend is registered')
    return this.backend
  }

  /** Validate an http(s) address against the configured bounds. */
  private validateUrl(url: string): string {
    const text = url.trim()
    if (text.length === 0 || text.length > this.config.maxUrlLength) {
      throw this.error('INVALID_URL', 'browser address is empty or too long')
    }
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      throw this.error('INVALID_URL', 'browser address is not a valid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw this.error('INVALID_URL', 'browser address must be http(s)')
    }
    if (parsed.username !== '' || parsed.password !== '') {
      throw this.error('INVALID_URL', 'browser address must not contain credentials')
    }
    return parsed.href
  }

  /**
   * Current tracked snapshot for one profile.
   * @param profile - profile to read.
   * @returns the tracked snapshot, with status closed when nothing is open.
   */
  snapshot(profile: BrowserProfile): BrowserSurfaceSnapshot {
    const record = this.records.get(profile)
    if (record === undefined) {
      return { profile, url: undefined, title: '', titleSource: 'unknown', status: 'closed', source: 'user' }
    }
    return {
      profile,
      url: record.url,
      title: '',
      titleSource: 'unknown',
      status: record.url === undefined ? 'closed' : 'open',
      source: record.source,
    }
  }

  /**
   * Open or navigate one profile.
   * @param owner - exact owning Agent, or undefined for a user/UI-driven change.
   * @param request - target profile and validated http(s) address.
   * @param signal - cancellation of the operation.
   * @returns the resulting tracked snapshot.
   */
  async open(owner: Agent | undefined, request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserSurfaceSnapshot> {
    const backend = this.requireBackend()
    const url = this.validateUrl(request.url)
    signal?.throwIfAborted()
    const record = this.records.get(request.profile)
    if (owner !== undefined && record?.owner !== undefined && record.owner !== owner) {
      throw this.error('FOREIGN_OWNER', `browser profile ${request.profile} is owned by another agent`)
    }
    const spec: BrowserBackendSpec = { profile: request.profile, url, owner, signal }
    await backend.open(spec)
    signal?.throwIfAborted()
    const next: SurfaceRecord = { url, owner, source: owner === undefined ? 'user' : 'agent' }
    this.records.set(request.profile, next)
    if (owner !== undefined) this.ensureOwnerCleanup(owner)
    this.publish(this.snapshot(request.profile))
    return this.snapshot(request.profile)
  }

  /**
   * Close one profile.
   * @param owner - exact owning Agent, or undefined for a user/UI-driven change.
   * @param request - target profile.
   * @returns the resulting tracked snapshot.
   */
  async close(owner: Agent | undefined, request: BrowserCloseRequest): Promise<BrowserSurfaceSnapshot> {
    const backend = this.requireBackend()
    const record = this.records.get(request.profile)
    if (owner !== undefined && record?.owner !== undefined && record.owner !== owner) {
      throw this.error('FOREIGN_OWNER', `browser profile ${request.profile} is owned by another agent`)
    }
    const spec: BrowserBackendCloseSpec = { profile: request.profile, owner }
    await backend.close(spec)
    this.records.delete(request.profile)
    this.publish(this.snapshot(request.profile))
    return this.snapshot(request.profile)
  }

  /**
   * Read bounded content from a real page. A provider without content support
   * is refused by name rather than approximating page access.
   * @param owner - exact owning Agent, or undefined for a user/UI-driven read.
   * @param request - profile and optional URL to navigate before reading.
   * @param signal - cancellation of the operation.
   * @returns the bounded page content (untrusted page data).
   */
  async read(
    owner: Agent | undefined,
    request: { profile: BrowserProfile; url?: string },
    signal?: AbortSignal,
  ): Promise<BrowserPageContent> {
    const backend = this.requireContentBackend()
    this.assertOwner(owner, request.profile)
    const spec = this.contentSpec(owner, request, signal)
    const content = await backend.read(spec)
    this.trackNavigation(request.profile, content.url, owner)
    return content
  }

  /**
   * Activate one visible link and read the resulting page.
   * @param owner - exact owning Agent, or undefined for a user/UI-driven action.
   * @param request - profile, optional URL, and the link selector.
   * @param signal - cancellation of the operation.
   * @returns the bounded resulting page content.
   */
  async click(
    owner: Agent | undefined,
    request: { profile: BrowserProfile; url?: string; selector: BrowserLinkSelector },
    signal?: AbortSignal,
  ): Promise<BrowserPageContent> {
    const backend = this.requireContentBackend()
    this.assertOwner(owner, request.profile)
    const spec = this.contentSpec(owner, request, signal)
    const content = await backend.click({ ...spec, selector: request.selector })
    this.trackNavigation(request.profile, content.url, owner)
    return content
  }

  /** Resolve a content-capable backend or fail with a typed code. */
  private requireContentBackend(): BrowserContentBackend {
    const backend = this.backend
    if (backend === undefined) throw this.error('NO_BACKEND', 'no browser backend is registered')
    if (typeof (backend as BrowserContentBackend).read !== 'function'
      || typeof (backend as BrowserContentBackend).click !== 'function') {
      throw this.error('CONTENT_UNSUPPORTED', `browser backend ${backend.type} cannot read page content`)
    }
    return backend as BrowserContentBackend
  }

  /** Enforce exact-Agent ownership for one profile. */
  private assertOwner(owner: Agent | undefined, profile: BrowserProfile): void {
    const record = this.records.get(profile)
    if (owner !== undefined && record?.owner !== undefined && record.owner !== owner) {
      throw this.error('FOREIGN_OWNER', `browser profile ${profile} is owned by another agent`)
    }
  }

  /** Build a validated content spec from a request. */
  private contentSpec(
    owner: Agent | undefined,
    request: { profile: BrowserProfile; url?: string },
    signal: AbortSignal | undefined,
  ): BrowserContentSpec {
    return {
      profile: request.profile,
      url: request.url === undefined ? undefined : this.validateUrl(request.url),
      owner,
      signal,
    }
  }

  /** Record a navigation observed during a content operation. */
  private trackNavigation(profile: BrowserProfile, url: string, owner: Agent | undefined): void {
    this.records.set(profile, {
      url,
      owner: owner ?? this.records.get(profile)?.owner,
      source: owner === undefined ? 'user' : 'agent',
    })
    this.publish(this.snapshot(profile))
  }

  /** Publish one snapshot through the forwarded event seam. */
  private publish(snapshot: BrowserSurfaceSnapshot): void {
    // The event is declared by the Host Remote assembly that forwards it; this
    // definition-only package must not widen the global event vocabulary.
    ;(this.ctx.emit as (name: string, value: BrowserSurfaceSnapshot) => void)(BROWSER_SURFACE_EVENT, snapshot)
  }

  /** Release an agent's surfaces when its fiber ends. */
  private ensureOwnerCleanup(owner: Agent): void {
    if (this.detached.has(owner)) return
    const detach = owner.ctx.effect(() => () => {
      this.detached.delete(owner)
      for (const [key, record] of this.records) {
        if (record.owner === owner) {
          this.records.delete(key)
          this.publish(this.snapshot(key))
        }
      }
    }, 'browser-use owner cleanup')
    this.detached.set(owner, () => { void detach() })
  }

  /** Construct one typed error. */
  private error(code: BrowserErrorCode, message: string): BrowserError {
    return new BrowserError(code, message)
  }
}

export default BrowserSurfaceService

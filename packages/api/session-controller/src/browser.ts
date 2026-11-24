/**
 * Browser surface Remote. Exposes the single Host-owned browser state to the
 * renderer so agent-driven navigation becomes visible in the right-panel
 * browser. Requests are user-driven (no Agent identity), while tools write the
 * same state through `ctx.browser` with exact-Agent ownership.
 */
import type { Context } from '@greeneek/cordis'
import { Remote, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import type {} from '@greeneek/gnk-browser-use'
import type { BrowserProfile, BrowserSurfaceSnapshot } from '@greeneek/gnk-browser-use'
import type { BrowserRemoteRequest, BrowserRemoteSnapshot, BrowserWireContent } from './types.ts'
import { frameStream } from './frame-stream.ts'

/** Credential-free Remote over the browser-use seam. */
export class BrowserController extends TypertRemoteService {
  static inject = ['browser']

  /** @param ctx - Host context with the browser-use service. */
  constructor(ctx: Context) {
    super(ctx, 'browserController', { namespace: 'browser' })
  }

  /**
   * Current tracked state for one profile.
   * @param request - profile whose state is read.
   * @returns the projected browser state for that profile.
   */
  @Remote('state')
  state(request: BrowserRemoteRequest): BrowserRemoteSnapshot {
    return this.project(request.profile)
  }

  /**
   * Open or navigate one profile from the UI.
   * @param request - profile and URL to open.
   * @returns the projected browser state after navigation.
   */
  @Remote('navigate')
  async navigate(request: BrowserRemoteRequest & { url: string }): Promise<BrowserRemoteSnapshot> {
    const snapshot = await this.ctx.browser.open(undefined, {
      profile: request.profile as import('@greeneek/gnk-browser-use').BrowserProfile, url: request.url,
    })
    return this.project(snapshot.profile, snapshot)
  }

  /**
   * Close one profile from the UI.
   * @param request - profile to close.
   * @returns the projected browser state after closing.
   */
  @Remote('close')
  async close(request: BrowserRemoteRequest): Promise<BrowserRemoteSnapshot> {
    const snapshot = await this.ctx.browser.close(undefined, { profile: request.profile as import('@greeneek/gnk-browser-use').BrowserProfile })
    return this.project(snapshot.profile, snapshot)
  }

  /**
   * Read real page content through the Host browser runtime.
   * @param request - profile and optional URL to navigate before reading.
   * @returns the bounded page content; page data is untrusted.
   */
  @Remote('read')
  async read(request: BrowserRemoteRequest & { url?: string }): Promise<BrowserWireContent> {
    const content = await this.ctx.browser.read(undefined, {
      profile: request.profile as import('@greeneek/gnk-browser-use').BrowserProfile,
      ...(request.url === undefined ? {} : { url: request.url }),
    })
    return {
      url: content.url,
      title: content.title,
      text: content.text,
      links: content.links.map(link => ({ text: link.text, href: link.href })),
      status: content.status ?? null,
      truncated: content.truncated,
    }
  }

  /**
   * Stream surface changes from the moment of subscription.
   * @param request - profile whose changes are streamed.
   * @param signal - caller lifetime; abort ends the stream.
   * @returns projected snapshots, starting with the current state.
   */
  @Remote({ mode: 'stream' })
  async *events(request: BrowserRemoteRequest, signal: AbortSignal): AsyncIterable<BrowserRemoteSnapshot> {
    yield this.project(request.profile)
    yield* frameStream<BrowserRemoteSnapshot>(push => this.ctx.on('browser/surface', (snapshot: BrowserSurfaceSnapshot): void => {
      if (snapshot.profile !== request.profile) return
      push(this.project(snapshot.profile, snapshot))
    }), signal)
  }

  /** Project a Host snapshot to the wire shape. */
  private project(profile: string, snapshot?: BrowserSurfaceSnapshot): BrowserRemoteSnapshot {
    const source = snapshot ?? this.ctx.browser.snapshot(profile as BrowserProfile)
    return {
      profile,
      url: source.url ?? null,
      status: source.status,
      titleSource: source.titleSource,
      source: source.source,
    }
  }
}

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

/** Credential-free Remote over the browser-use seam. */
export class BrowserController extends TypertRemoteService {
  static inject = ['browser']

  /** @param ctx - Host context with the browser-use service. */
  constructor(ctx: Context) {
    super(ctx, 'browserController', { namespace: 'browser' })
  }

  /** Current tracked state for one profile. */
  @Remote('state')
  state(request: BrowserRemoteRequest): BrowserRemoteSnapshot {
    return this.project(request.profile)
  }

  /** Open or navigate one profile from the UI. */
  @Remote('navigate')
  async navigate(request: BrowserRemoteRequest & { url: string }): Promise<BrowserRemoteSnapshot> {
    const snapshot = await this.ctx.browser.open(undefined, {
      profile: request.profile as import('@greeneek/gnk-browser-use').BrowserProfile, url: request.url,
    })
    return this.project(snapshot.profile, snapshot)
  }

  /** Close one profile from the UI. */
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

  /** Stream surface changes from the moment of subscription. */
  @Remote({ mode: 'stream' })
  async *events(request: BrowserRemoteRequest, signal: AbortSignal): AsyncIterable<BrowserRemoteSnapshot> {
    yield this.project(request.profile)
    const queue: BrowserRemoteSnapshot[] = []
    let wake: (() => void) | undefined
    const listener = (snapshot: BrowserSurfaceSnapshot): void => {
      if (snapshot.profile !== request.profile) return
      queue.push(this.project(snapshot.profile, snapshot))
      wake?.()
      wake = undefined
    }
    const disposeListener = this.ctx.on('browser/surface', listener)
    const onAbort = (): void => { wake?.(); wake = undefined }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        while (queue.length > 0) {
          const frame = queue.shift()
          if (frame !== undefined) yield frame
        }
        if (signal.aborted) return
        await new Promise<void>((done) => { wake = done })
      }
    } finally {
      disposeListener()
      signal.removeEventListener('abort', onAbort)
    }
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

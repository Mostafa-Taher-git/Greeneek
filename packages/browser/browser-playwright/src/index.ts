/**
 * Real browser content provider for the browser-use seam. It launches a local
 * Chromium through Playwright with one persistent context per browser profile,
 * and lets an Agent navigate real pages, read bounded visible text and links,
 * and follow links. Every returned string is untrusted page data, never
 * instructions. No CAPTCHA/MFA/anti-bot bypass is attempted.
 * @module @greeneek/gnk-browser-playwright
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@greeneek/cordis'
import type {
  BrowserBackendCloseSpec, BrowserBackendSpec, BrowserContentBackend, BrowserContentSpec,
  BrowserLinkSelector, BrowserPageContent,
} from '@greeneek/gnk-browser-use'
import { BrowserError } from '@greeneek/gnk-browser-use'
import type { BrowserContext, Page, Response } from 'playwright'
import { chromium } from 'playwright'

/** Resolved provider config. Browser storage lives under `userDataRoot`. */
export interface PlaywrightBrowserConfig {
  /** Root directory holding one persistent profile directory per browser profile. */
  readonly userDataRoot: string
  /** Run the browser without a visible window. */
  readonly headless: boolean
  /** Navigation timeout in milliseconds. */
  readonly timeoutMs: number
  /** Maximum page text characters returned by one read. */
  readonly maxContentChars: number
  /** Maximum links returned by one read. */
  readonly maxLinks: number
}

/** One live profile context with its current page and last response status. */
interface ProfileSession {
  context: BrowserContext
  page: Page
  lastStatus: number | undefined
  /** Temporary directory to remove on close (non-persistent profiles only). */
  ephemeralDir: string | undefined
}

/**
 * Playwright-backed content provider. One persistent context is kept per
 * profile: the `default` profile uses a durable directory under `userDataRoot`
 * (so logged-in sessions survive restarts), while `incognito` uses a fresh temp
 * directory removed on close. Sessions are isolated by directory, so no
 * provider can read another's cookies or local storage.
 */
class PlaywrightContentBackend implements BrowserContentBackend {
  readonly type = 'playwright'

  private readonly sessions = new Map<'default' | 'incognito', ProfileSession>()
  private readonly openings = new Map<'default' | 'incognito', Promise<ProfileSession>>()

  /** @param config - resolved launch and extraction limits. */
  constructor(private readonly config: PlaywrightBrowserConfig) {}

  /** Get or lazily open the persistent context for one profile. */
  private getSession(profile: 'default' | 'incognito'): Promise<ProfileSession> {
    const existing = this.sessions.get(profile)
    if (existing !== undefined && !existing.page.isClosed()) return Promise.resolve(existing)
    const opening = this.openings.get(profile)
    if (opening !== undefined) return opening
    const next = this.openProfile(profile)
      .then((session) => {
        this.sessions.set(profile, session)
        return session
      })
      .finally(() => { this.openings.delete(profile) })
    this.openings.set(profile, next)
    return next
  }

  /** Launch one persistent context and return its page. */
  private async openProfile(profile: 'default' | 'incognito'): Promise<ProfileSession> {
    let userDataDir: string
    let ephemeralDir: string | undefined
    if (profile === 'default') {
      userDataDir = join(this.config.userDataRoot, 'default')
    } else {
      ephemeralDir = mkdtempSync(join(tmpdir(), 'gnk-browser-incognito-'))
      userDataDir = ephemeralDir
    }
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: this.config.headless,
      })
      const page = context.pages()[0] ?? await context.newPage()
      return { context, page, lastStatus: undefined, ephemeralDir }
    } catch (error) {
      if (ephemeralDir !== undefined) {
        try { rmSync(ephemeralDir, { recursive: true, force: true }) } catch { /* best effort */ }
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new BrowserError('NAVIGATION_FAILED', `could not launch browser profile ${profile}: ${message}`)
    }
  }

  /** Navigate one profile to an address. */
  async open(spec: BrowserBackendSpec): Promise<void> {
    const session = await this.getSession(spec.profile)
    await this.navigate(session, spec.url, spec.signal)
  }

  /** Navigate a session and record the HTTP status. */
  private async navigate(session: ProfileSession, url: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    try {
      const response: Response | null = await session.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      })
      session.lastStatus = response?.status()
      signal?.throwIfAborted()
    } catch (error) {
      if (signal?.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new BrowserError('NAVIGATION_FAILED', `browser navigation failed for ${url}: ${message}`)
    }
  }

  /** Read bounded visible text and links from a page. */
  async read(spec: BrowserContentSpec): Promise<BrowserPageContent> {
    const session = await this.getSession(spec.profile)
    if (spec.url !== undefined) await this.navigate(session, spec.url, spec.signal)
    else if (session.page.url() === 'about:blank') {
      throw new BrowserError('NO_SURFACE', 'no page is open; provide a URL to read')
    }
    signalCheck(spec.signal)
    return this.extract(session)
  }

  /** Activate one visible link and read the resulting page. */
  async click(
    spec: BrowserContentSpec & { selector: BrowserLinkSelector },
  ): Promise<BrowserPageContent> {
    const session = await this.getSession(spec.profile)
    if (spec.url !== undefined) await this.navigate(session, spec.url, spec.signal)
    const { text, href } = spec.selector
    if (text === undefined && href === undefined) {
      throw new BrowserError('LINK_NOT_FOUND', 'a link selector must name text or href')
    }
    try {
      const byText = text === undefined ? null : session.page.locator('a[href]').filter({ hasText: text })
      const byHref = href === undefined ? null : session.page.locator(`a[href*="${cssEscape(href)}"]`)
      const target = (byText !== null && await byText.count() > 0)
        ? byText.first()
        : (byHref !== null && await byHref.count() > 0)
          ? byHref.first()
          : undefined
      if (target === undefined) {
        throw new BrowserError('LINK_NOT_FOUND', `no link matched ${JSON.stringify(spec.selector)}`)
      }
      await target.click({ timeout: this.config.timeoutMs })
      await session.page.waitForLoadState('domcontentloaded', { timeout: this.config.timeoutMs }).catch(() => {})
    } catch (error) {
      if (error instanceof BrowserError) throw error
      if (spec.signal?.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new BrowserError('NAVIGATION_FAILED', `browser link activation failed: ${message}`)
    }
    signalCheck(spec.signal)
    return this.extract(session)
  }

  /** Extract bounded content from the current page. */
  private async extract(session: ProfileSession): Promise<BrowserPageContent> {
    const page = session.page
    const title = (await page.title()).slice(0, 300)
    const rawText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    const truncated = rawText.length > this.config.maxContentChars
    const text = rawText.slice(0, this.config.maxContentChars)
    const hrefs = await page.locator('a[href]').evaluateAll(anchors => anchors
      .slice(0, 500)
      .map(a => ({
        text: ((a.textContent as string | null) ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
        href: a.getAttribute('href') ?? '',
      })))
    const links = hrefs.map((link) => {
      let absolute = link.href
      try { absolute = new URL(link.href, page.url()).href } catch { /* keep raw */ }
      return { text: link.text, href: absolute }
    }).slice(0, this.config.maxLinks)
    return { url: page.url(), title, text, links, status: session.lastStatus, truncated }
  }

  /** Close one profile session. */
  async close(spec: BrowserBackendCloseSpec): Promise<void> {
    const session = this.sessions.get(spec.profile)
    if (session === undefined) return
    this.sessions.delete(spec.profile)
    await session.context.close().catch(() => {})
    if (session.ephemeralDir !== undefined) {
      try { rmSync(session.ephemeralDir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }

  /** Close all profile sessions on disposal. */
  async dispose(): Promise<void> {
    for (const profile of [...this.sessions.keys()]) {
      await this.close({ profile, owner: undefined })
    }
  }
}

/** Throw on an aborted signal with a stable message. */
function signalCheck(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BrowserError('SERVICE_DISPOSING', 'browser operation was cancelled')
}

/** Escape a string for safe use inside an attribute-selector quoted value. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/** Required service. */
export const inject = ['browser']

/** Resolve config with explicit defaults; storage root is caller-supplied. */
export function resolveConfig(
  config: Partial<PlaywrightBrowserConfig> & { userDataRoot: string },
): PlaywrightBrowserConfig {
  return {
    userDataRoot: config.userDataRoot,
    headless: config.headless ?? true,
    timeoutMs: config.timeoutMs ?? 30_000,
    maxContentChars: config.maxContentChars ?? 100_000,
    maxLinks: config.maxLinks ?? 100,
  }
}

/** Install the Playwright content backend and dispose it with the fiber. */
export function apply(ctx: Context, config: PlaywrightBrowserConfig): void {
  const backend = new PlaywrightContentBackend(config)
  ctx.browser.registerBackend(backend)
  ctx.effect(() => async () => { await backend.dispose() }, 'browser-playwright teardown')
}

export default { name: 'browser-playwright', inject, apply }

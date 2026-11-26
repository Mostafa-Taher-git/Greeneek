// Trusted non-loopback Web access cannot call the loopback-only settings API;
// the notice therefore advances for this browser process and returns on reload.
import { createRequire } from 'node:module'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
// The CommonJS binding is mutable; an ESM namespace import is not.
const dns = createRequire(import.meta.url)('node:dns') as typeof import('node:dns')

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const originalLookup = dns.lookup

  beforeAll(async () => {
    // Windows has no wildcard *.localhost DNS. Keep the synthetic authority in
    // the URL and Host header (the trusted-host behavior under test), and map
    // only the resolution used by Node's fetch to loopback.
    const lookupImpl = originalLookup as (hostname: string, ...args: unknown[]) => unknown
    dns.lookup = ((hostname: string, ...args: unknown[]) => {
      return lookupImpl(hostname === 'remote.localhost' ? '127.0.0.1' : hostname, ...args)
    }) as typeof dns.lookup
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.localhost',
      welcomeNoticePending: true,
    })
    // Keep the non-loopback authority under test while making the synthetic
    // hostname resolvable on hosts without wildcard *.localhost DNS (Windows).
    browser = await chromium.launch({
      args: ['--host-resolver-rules=MAP remote.localhost 127.0.0.1'],
    })
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    dns.lookup = originalLookup
    await browser?.close()
    await scaffold?.close()
  })

  it('advances process-locally and presents the notice again after reload', async () => {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})

// Keyless browser e2e: a user who configures some other provider is never
// asked for a key again, and the first-run step is one they can dismiss. No
// official route is mounted (BYO-key models only), so the Models page opens
// on the dormant catalog and the add card does the configuring.
// Zero model calls: configuration is pure settings/credentials/llm-domain
// traffic.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/onboarding-usable-provider', import.meta.url))
const DISMISSED_EXPECTED = join(SNAPSHOT_DIR, 'dismissed.expected.md')
const MODE = webSnapshotMode()
const CREDENTIAL_STEP = '添加一个 API Key 开始使用'

describe.skipIf(MODE === 'record')('web e2e: another usable provider ends first-run onboarding', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ greeneekMissingCredential: true })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('dismisses first-run and opens the add card over the dormant catalog', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-setup-card-cancel'))
    const credentialStep = page.getByRole('dialog', { name: CREDENTIAL_STEP })
    await credentialStep.waitFor({ timeout: 15_000 })
    await credentialStep.getByRole('button', { name: '稍后配置' }).click()
    await credentialStep.waitFor({ state: 'detached', timeout: 15_000 })

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    // Dismissing the onboarding step leaves Settings closed, so enter the
    // Models section explicitly before exercising its normal cards.
    await settings.getByRole('button', { name: '模型' }).click()
    // BYO-key only: no official route is mounted, so first-run shows the
    // dormant catalog — one add button, no rows and no setup card.
    const add = settings.getByRole('button', { name: '添加提供方' })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    const pick = settings.getByLabel('提供方')
    await pick.waitFor({ timeout: 10_000 })
    await pick.selectOption('minimax-cn')
    // The draft offers catalog display names while selecting by route id.
    const options = await pick.locator('option').allTextContents()
    expect(options).toContain('MiniMax CN')
    await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).waitFor({ timeout: 10_000 })
    const dismissed = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DISMISSED_EXPECTED, dismissed, MODE)

    // Cancelling the add card returns to the dormant catalog.
    await settings.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(async () => settings.getByLabel('提供方').count(), { timeout: 10_000 }).toBe(0)

    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('stops prompting once another provider can serve requests', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-other-provider'))
    const settings = page.getByRole('dialog', { name: '设置' })
    // The previous test left the dormant catalog; configure minimax-cn now.
    await settings.getByRole('button', { name: '添加提供方' }).click()
    const pick = settings.getByLabel('提供方')
    await pick.waitFor({ timeout: 10_000 })
    await pick.selectOption('minimax-cn')
    await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('sk-e2e-minimax')
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 MiniMax CN (minimax-cn)。', { exact: true }).waitFor({ timeout: 15_000 })

    // Only minimax-cn is reachable; nothing official exists to hold a credential.
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials).toContain('MINIMAX_CN_API_KEY: sk-e2e-minimax')
    expect(credentials).not.toContain('GREENEEK_API_KEY')

    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    // The regression: the step read only the official route's credential, so a
    // fully configured user was taken over on every blank session.
    await expect.poll(
      async () => page.getByRole('dialog', { name: CREDENTIAL_STEP }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)

    // The Models page agrees: the configured row stands with no setup card
    // over a user who already has somewhere to send a request.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型' }).click()
    await settings.getByText('MiniMax CN', { exact: true }).first().waitFor({ timeout: 10_000 })
    expect(await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).count()).toBe(0)

    expect((await page.content()).includes('sk-e2e-minimax')).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['dismissed.expected.md'])
  })
})

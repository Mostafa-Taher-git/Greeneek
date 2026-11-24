// Keyless browser regression for tiled session panes: four live pages, drag
// geometry, and persistence across reload. No provider key is involved.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../tests/expected/session-tiling', import.meta.url))
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

/** Normalized pane rectangles, platform-neutral and stable across reload. */
async function geometry(page: Page): Promise<string> {
  const tiles = await page.locator('[data-tile]').evaluateAll(elements => elements.map(element => ({
    id: element.getAttribute('data-tile'),
    left: Math.round(Number.parseFloat((element as HTMLElement).style.left)),
    top: Math.round(Number.parseFloat((element as HTMLElement).style.top)),
    width: Math.round(Number.parseFloat((element as HTMLElement).style.width)),
    height: Math.round(Number.parseFloat((element as HTMLElement).style.height)),
    frame: element.querySelector('iframe')?.getAttribute('src')?.includes('tile=') === true,
  })))
  return [
    '# Tiled session geometry',
    '',
    `- panes: ${tiles.length}`,
    ...tiles.flatMap(tile => [
      `## ${tile.id}`,
      '',
      `- rect: ${tile.left}, ${tile.top}, ${tile.width}, ${tile.height}`,
      `- pane-scoped page: ${String(tile.frame)}`,
      '',
    ]),
  ].join('\n').trimEnd()
}

describe.skipIf(MODE === 'record')('web e2e: session tiling', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    browser = await chromium.launch()
    context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('tiles four panes, resizes one, and keeps the geometry after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-tiling'))
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled
    await page.getByRole('button', { name: 'Tile sessions' }).click()
    expect(await page.locator('[data-tile]').count()).toBe(4)
    expect(tripwire.pageErrors).toEqual([])

    const handle = page.locator('[data-tile="tile-01"] [role="separator"]')
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x - 120, box!.y - 60, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => await page.locator('[data-tile="tile-01"]').evaluate(
      element => (element as HTMLElement).style.width,
    )).not.toBe('50%')

    await compareOrRefreshGolden(GEOMETRY_EXPECTED, await geometry(page), MODE)

    // A fresh page in the same browser context shares localStorage, which is
    // the persistence contract under test; reloading the four-iframe page
    // would keep the streaming shell from ever settling its load event.
    await page.close()
    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect.poll(async () => await page.locator('[data-tile]').count()).toBe(4)
    await expect.poll(async () => await page.locator('[data-tile="tile-01"]').evaluate(
      element => (element as HTMLElement).style.width,
    )).not.toBe('50%')
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, await geometry(page), MODE)

    // The shipped layout is capped at four; the Add gesture is disabled.
    expect(await page.getByRole('button', { name: 'Add pane' }).first().isDisabled()).toBe(true)
    expect(await page.locator('[data-tile]').count()).toBe(4)
    const boxes = await page.locator('[data-tile]').evaluateAll((elements) => {
      return elements.map((element) => {
        const rect = (element as HTMLElement).getBoundingClientRect()
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
      })
    })
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const left = boxes[a]
        const right = boxes[b]
        const overlaps = left.x < right.x + right.w - 1 && right.x < left.x + left.w - 1
          && left.y < right.y + right.h - 1 && right.y < left.y + left.h - 1
        expect(overlaps, `panes ${a + 1} and ${b + 1} overlap`).toBe(false)
      }
    }
  })
})

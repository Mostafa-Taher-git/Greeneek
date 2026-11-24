import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { Context } from '@greeneek/cordis'
import BrowserSurfaceService from '@greeneek/gnk-browser-use'
import { resolveConfig, apply } from '../src/index.ts'
import type { BrowserPageContent } from '@greeneek/gnk-browser-use'

const FIXTURE = readFileSync(new URL('./fixtures/content.html', import.meta.url), 'utf8')

/** Serve the owned HTML fixture on an ephemeral loopback port. */
async function servePage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(FIXTURE)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

describe('Playwright browser content provider', () => {
  it('reads real text, title, links and status from the owned fixture', async () => {
    const page = await servePage()
    const userDataRoot = mkdtempSync(join(tmpdir(), 'gnk-pw-test-'))
    const ctx = new Context()
    try {
      await ctx.plugin(BrowserSurfaceService)
      await ctx.plugin(
        { name: 'browser-playwright-test', inject: ['browser'], apply },
        resolveConfig({ userDataRoot, headless: true, timeoutMs: 15000 }),
      )
      const result: BrowserPageContent = await ctx.browser.read(undefined, {
        profile: 'default', url: page.url,
      })
      expect(result.title).toBe('Probe')
      expect(result.text).toContain('GNK_PW_CONTENT_OK')
      expect(result.links.some(link => link.href.includes('example.com/next'))).toBe(true)
      expect(result.status).toBe(200)
      expect(result.truncated).toBe(false)
    } finally {
      await ctx.fiber.dispose()
      await page.close()
      rmSync(userDataRoot, { recursive: true, force: true })
    }
  }, 60000)
})

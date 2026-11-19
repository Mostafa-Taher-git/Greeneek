import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { Context } from '@greeneek/cordis'
import BrowserSurfaceService from '@greeneek/gnk-browser-use'
import { resolveConfig, apply } from '../src/index.ts'
import type { BrowserPageContent } from '@greeneek/gnk-browser-use'

const root = mkdtempSync(join(tmpdir(), 'gnk-pw-test-'))

/** Serve a tiny HTML page on an ephemeral loopback port. */
async function servePage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><head><title>Probe</title></head><body><p>GNK_PW_CONTENT_OK</p><a href="https://example.com/next">next</a></body></html>')
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
  it('reads real text, title, links and status from a live page', async () => {
    const page = await servePage()
    const ctx = new Context()
    await ctx.plugin(BrowserSurfaceService)
    await ctx.plugin(
      { name: 'browser-playwright-test', inject: ['browser'], apply },
      resolveConfig({ userDataRoot: root, headless: true, timeoutMs: 15000 }),
    )
    try {
      const result: BrowserPageContent = await ctx.browser.read(undefined, {
        profile: 'default', url: page.url,
      })
      expect(result.title).toBe('Probe')
      expect(result.text).toContain('GNK_PW_CONTENT_OK')
      expect(result.links.some(l => l.href.includes('example.com/next'))).toBe(true)
      expect(result.status).toBe(200)
      expect(result.truncated).toBe(false)
    } finally {
      await ctx.fiber.dispose()
      await page.close()
    }
  }, 60000)

  it('cleans the temp root at suite teardown', () => {
    expect(() => { rmSync(root, { recursive: true, force: true }) }).not.toThrow()
  })
})

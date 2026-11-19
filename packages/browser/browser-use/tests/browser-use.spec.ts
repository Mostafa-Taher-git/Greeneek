import { describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { BrowserSurfaceService, BROWSER_SURFACE_EVENT, type BrowserSurfaceSnapshot } from '../src/index.ts'
import { BrowserError } from '../src/error.ts'
import type { BrowserBackend } from '../src/types.ts'

function backend(type = 'surface-state'): BrowserBackend {
  return { type, open: vi.fn(async () => {}), close: vi.fn(async () => {}) }
}

describe('BrowserSurfaceService', () => {
  it('rejects a second backend and releases the first on disposal', async () => {
    const ctx = new Context()
    const service = new BrowserSurfaceService(ctx)
    const first = backend()
    const dispose = service.registerBackend(first)
    expect(() => service.registerBackend(backend('second'))).toThrow('already registered')
    dispose()
    expect(() => service.registerBackend(backend('second'))).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('validates addresses and tracks owner-scoped navigation', async () => {
    const ctx = new Context()
    const service = new BrowserSurfaceService(ctx)
    service.registerBackend(backend())
    await expect(service.open(undefined, { profile: 'default', url: 'file:///etc/passwd' }))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
    const agent = { id: 'a', ctx } as never
    const opened = await service.open(agent, { profile: 'default', url: 'https://example.com' })
    expect(opened).toMatchObject({ profile: 'default', status: 'open', url: 'https://example.com/', source: 'agent', titleSource: 'unknown' })
    const other = { id: 'b', ctx } as never
    await expect(service.open(other, { profile: 'default', url: 'https://other.example' }))
      .rejects.toMatchObject({ code: 'FOREIGN_OWNER' })
    const closed = await service.close(agent, { profile: 'default' })
    expect(closed.status).toBe('closed')
    await ctx.fiber.dispose()
  })

  it('emits a surface event on every change', async () => {
    const ctx = new Context()
    const service = new BrowserSurfaceService(ctx)
    service.registerBackend(backend())
    const seen: unknown[] = []
    ctx.on(BROWSER_SURFACE_EVENT, (snapshot: BrowserSurfaceSnapshot) => { seen.push(snapshot) })
    await service.open(undefined, { profile: 'incognito', url: 'https://www.google.com' })
    await service.close(undefined, { profile: 'incognito' })
    expect(seen.length).toBe(2)
    expect((seen[0] as { profile: string }).profile).toBe('incognito')
    await ctx.fiber.dispose()
  })

  it('fails with a stable code when no backend is registered', async () => {
    const ctx = new Context()
    const service = new BrowserSurfaceService(ctx)
    await expect(service.open(undefined, { profile: 'default', url: 'https://a.example' }))
      .rejects.toBeInstanceOf(BrowserError)
    await ctx.fiber.dispose()
  })
})

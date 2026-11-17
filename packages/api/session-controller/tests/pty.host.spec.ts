import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import { PtyController } from '../src/pty.ts'

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('PtyController workspace fence', () => {
  it('refuses a path outside every registered workspace', async () => {
    const ctx = new Context()
    roots.push(ctx)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const controller = new PtyController(ctx)
    expect(() => controller.open({ path: '/outside', cols: 80, rows: 24 })).toThrow('outside every workspace')
  })

  it('refuses operations on an unknown session', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const controller = new PtyController(ctx)
    expect(() => { controller.write({ id: 'missing', data: 'x' }) }).toThrow()
  })
})

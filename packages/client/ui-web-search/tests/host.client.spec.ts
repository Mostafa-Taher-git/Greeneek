import { Context } from '@greeneek/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-web-search host', () => {
  it('provides no host-side behavior', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ apply }).await()).resolves.toBeDefined()
  })
})

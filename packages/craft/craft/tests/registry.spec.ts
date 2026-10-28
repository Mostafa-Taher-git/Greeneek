import { describe, expect, it } from 'vitest'
import { hashCommandRegistry } from '../src/registry.ts'

describe('hashCommandRegistry', () => {
  it('canonicalizes nested object keys and hashes their UTF-8 JSON representation', () => {
    expect(hashCommandRegistry({ z: 'x', a: [1, { b: true, a: null }] }))
      .toBe('sha256:252c405a771f72ae11b47f6a7a7b0c84d79c46f223767598de8d075018722999')
    expect(hashCommandRegistry({ a: [1, { a: null, b: true }], z: 'x' }))
      .toBe('sha256:252c405a771f72ae11b47f6a7a7b0c84d79c46f223767598de8d075018722999')
  })

  it('keeps array order significant', () => {
    expect(hashCommandRegistry({ commands: ['a', 'b'] }))
      .not.toBe(hashCommandRegistry({ commands: ['b', 'a'] }))
  })

  it('changes the digest when a command or its schema changes', () => {
    const original = { commands: [{ id: 'convert', input: { type: 'object' } }] }
    expect(hashCommandRegistry(original)).not.toBe(hashCommandRegistry({ commands: [{ id: 'export', input: { type: 'object' } }] }))
    expect(hashCommandRegistry(original)).not.toBe(hashCommandRegistry({ commands: [{ id: 'convert', input: { type: 'string' } }] }))
  })

  it('rejects a missing JSON result instead of trusting an unstable digest', () => {
    expect(() => hashCommandRegistry(undefined)).toThrow(expect.objectContaining({ code: 'CRAFT_APP_ERROR' }))
  })
})

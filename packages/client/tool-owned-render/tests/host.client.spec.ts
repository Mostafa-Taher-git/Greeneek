// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply as hostApply } from '../src/index.ts'

describe('host entry', () => {
  it('provides no host-side behavior', () => {
    expect(() => { hostApply() }).not.toThrow()
  })
})

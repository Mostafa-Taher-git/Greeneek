import { describe, expect, it } from 'vitest'
import { resolveSafeMode } from '../src/profile-boot.ts'

describe('resolveSafeMode', () => {
  it('boots the full composition when the switch is unset or empty', () => {
    expect(resolveSafeMode(undefined)).toBe(false)
    expect(resolveSafeMode('')).toBe(false)
  })

  it('boots core bundles only on ANY non-empty value, including falsy-looking ones', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveSafeMode(value)).toBe(true)
    }
  })
})

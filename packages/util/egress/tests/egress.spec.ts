/**
 * Unit coverage for the egress policy: nothing is blocked by default, strict
 * allow-listing is opt-in, and every failure surfaces as
 * `EgressBlockedError` with the hostname attached.
 * @module
 */

import { describe, expect, it } from 'vitest'
import { BLOCKED_HOSTS, EgressBlockedError, STRICT_ALLOWED_HOSTS, assertEgressAllowed } from '../src/index.ts'

describe('assertEgressAllowed', () => {
  it('blocks no provider by default: every absolute URL passes', () => {
    expect(() =>{  assertEgressAllowed('https://example.org/anything', {}) }).not.toThrow()
  })

  it.each([
    'https://api.deepseek.com/chat/completions',
    'https://api.deepseek.com',
    'http://deepseek.com',
    'https://platform.deepseek.com/keys',
    'https://api.kilo.ai/api/gateway',
    'https://www.google.com',
  ])('reaches every operator-configured endpoint: %s', (url) => {
    expect(() =>{  assertEgressAllowed(url, {}) }).not.toThrow()
  })

  it('refuses non-allow-listed hosts under strict mode', () => {
    expect(() =>{  assertEgressAllowed('https://example.org', { GNK_STRICT_EGRESS: '1' }) }).toThrow(/allows only/)
    expect(() =>{  assertEgressAllowed('https://api.greeneek.dev/v1', { GNK_STRICT_EGRESS: '1' }) }).toThrow(/allows only/)
  })

  it('wraps unparseable endpoints into the one error class', () => {
    expect(() =>{  assertEgressAllowed('not a url', {}) }).toThrow(EgressBlockedError)
    expect(() =>{  assertEgressAllowed('not a url', {}) }).toThrow(/not an absolute URL/)
  })

  it('attaches the refused hostname', () => {
    try {
      assertEgressAllowed('not a url', {})
      expect.unreachable('unparseable endpoint must not pass')
    } catch (error) {
      expect(error).toBeInstanceOf(EgressBlockedError)
      expect((error as EgressBlockedError).hostname).toBe('not a url')
    }
  })

  it('ships an empty blocklist and no built-in allow-list entries: every strict host is user-configured', () => {
    expect(BLOCKED_HOSTS).toHaveLength(0)
    expect(STRICT_ALLOWED_HOSTS.size).toBe(0)
  })

  it('keeps the blocklist as the single deployment override point', () => {
    const pattern = /^blocked\.example$/
    // Test-only mutation: the export is readonly so production code cannot
    // widen it by accident; a deployment override would replace the module.
    const mutable = BLOCKED_HOSTS as RegExp[]
    mutable.push(pattern)
    try {
      expect(() =>{  assertEgressAllowed('https://blocked.example/v1', {}) }).toThrow(EgressBlockedError)
      // A listed host refuses even where strict mode would otherwise allow-list it.
      expect(() =>{  assertEgressAllowed('https://blocked.example/v1', { GNK_STRICT_EGRESS: '1' }) })
        .toThrow(/deployment blocklist/)
    } finally {
      mutable.pop()
    }
    expect(() =>{  assertEgressAllowed('https://blocked.example/v1', {}) }).not.toThrow()
  })
})

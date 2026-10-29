import { describe, expect, it } from 'vitest'
import {
  assertFavoriteProviderReady,
  favoriteMemberRequest,
  fleetProviderAvailability,
  validateFleetFavorite,
  validateFleetSettings,
  type FleetFavorite,
  type FleetProviderAvailability,
} from '../src/fleet-settings.ts'

const FAVORITE: FleetFavorite = {
  id: 'review-fleet',
  name: 'Review fleet',
  members: [{ name: 'reviewer', description: 'review', prompt: 'review it', provider: 'spawn' }],
}

describe('fleet provider availability', () => {
  it('distinguishes ready, unsupported, and uninstalled providers', () => {
    const rows = fleetProviderAvailability(
      ['spawn', 'fork', 'missing'],
      ['spawn', 'fork', 'claude-code'],
      new Set(['spawn', 'fork']),
    )

    expect(rows).toEqual([
      expect.objectContaining({ name: 'claude-code', state: 'unsupported-version', continuable: false }),
      expect.objectContaining({ name: 'fork', state: 'ready', continuable: true }),
      expect.objectContaining({ name: 'missing', state: 'not-installed', continuable: false }),
      expect.objectContaining({ name: 'spawn', state: 'ready', continuable: true }),
    ])
    expect(rows.find(row => row.name === 'missing')?.detail).toContain('not registered')
    expect(rows.find(row => row.name === 'claude-code')?.detail).toContain('durable Team lane')
  })

  it('refuses an unavailable provider without substituting a ready one', () => {
    const rows: FleetProviderAvailability[] = [
      { name: 'spawn', state: 'ready', continuable: true },
      { name: 'missing', state: 'not-installed', continuable: false },
    ]
    expect(() => { assertFavoriteProviderReady(FAVORITE.members[0]!, rows) }).not.toThrow()
    expect(() => {
      assertFavoriteProviderReady({ ...FAVORITE.members[0]!, provider: 'missing' }, rows)
    }).toThrow('refusing to substitute another provider')
    expect(() => {
      assertFavoriteProviderReady({ ...FAVORITE.members[0]!, provider: 'absent' }, rows)
    }).toThrow('is not-installed')
  })
})

describe('favorite member requests', () => {
  it('maps a minimal member and a fully specified member', () => {
    expect(favoriteMemberRequest(FAVORITE.members[0]!)).toEqual({
      name: 'reviewer',
      description: 'review',
      prompt: [{ type: 'text', text: 'review it' }],
      context: 'fresh',
      provider: 'spawn',
    })
    expect(favoriteMemberRequest({
      name: 'full',
      description: 'full member',
      prompt: 'work',
      provider: 'fork',
      context: 'fork',
      preset: 'reviewing',
      model: 'mock',
      reasoningEffort: 'high',
      readOnly: true,
      maxTokens: 2_000,
    })).toEqual({
      name: 'full',
      description: 'full member',
      prompt: [{ type: 'text', text: 'work' }],
      context: 'fork',
      provider: 'fork',
      agentPreset: 'reviewing',
      agentOptions: { model: 'mock', reasoningEffort: 'high' },
      readOnly: true,
      maxTokens: 2_000,
    })
    expect(favoriteMemberRequest({
      ...FAVORITE.members[0]!, writeScopes: ['src'], readOnly: false,
    })).toMatchObject({ writeScopes: ['src'] })
    expect(favoriteMemberRequest({ ...FAVORITE.members[0]!, model: 'mock' })).toMatchObject({
      agentOptions: { model: 'mock' },
    })
    expect(favoriteMemberRequest({ ...FAVORITE.members[0]!, reasoningEffort: 'low' })).toMatchObject({
      agentOptions: { reasoningEffort: 'low' },
    })
  })
})

describe('fleet favorite validation', () => {
  it('accepts a valid favorite', () => {
    expect(() => { validateFleetFavorite(FAVORITE) }).not.toThrow()
    expect(() => { validateFleetSettings({ favorites: [FAVORITE] }) }).not.toThrow()
  })

  it('rejects duplicate ids and invalid member lane policy', () => {
    expect(() => {
      validateFleetSettings({ favorites: [FAVORITE, { ...FAVORITE, name: 'Second' }] })
    }).toThrow('duplicated')
    expect(() => {
      validateFleetFavorite({
        ...FAVORITE,
        members: [{ ...FAVORITE.members[0]!, readOnly: true, writeScopes: ['src'] }],
      })
    }).toThrow('invalid lane policy')
    expect(() => {
      validateFleetFavorite({ ...FAVORITE, members: [] })
    }).toThrow('at least one member')
    expect(() => {
      validateFleetFavorite({ ...FAVORITE, id: 'Bad Id' })
    }).toThrow('lower-kebab-case')
    expect(() => {
      validateFleetFavorite({ ...FAVORITE, members: [FAVORITE.members[0]!, FAVORITE.members[0]!] })
    }).toThrow('repeats member')
  })

  it('rejects every empty or malformed member field', () => {
    const cases: Array<[FleetFavorite, string]> = [
      [{ ...FAVORITE, name: '   ' }, 'name must be non-empty'],
      [{ ...FAVORITE, members: [{ ...FAVORITE.members[0]!, name: 'Lead' }] }, 'lower-kebab-case'],
      [{ ...FAVORITE, members: [{ ...FAVORITE.members[0]!, description: '' }] }, 'needs a description and prompt'],
      [{ ...FAVORITE, members: [{ ...FAVORITE.members[0]!, prompt: '' }] }, 'needs a description and prompt'],
      [{ ...FAVORITE, members: [{ ...FAVORITE.members[0]!, provider: ' ' }] }, 'needs a provider'],
    ]
    for (const [favorite, message] of cases) {
      expect(() => { validateFleetFavorite(favorite) }, message).toThrow(message)
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  GREENEEK_HARNESS,
  LEGACY_GREENEEK_STRATEGIES,
  migrateFleetMember,
  migrateFleetSettings,
  userFacingConnection,
} from '../src/fleet-migration.ts'
import type { FleetFavoriteMember, FleetSettings } from '../src/fleet-settings.ts'

const MEMBER: FleetFavoriteMember = {
  name: 'implementer',
  description: 'write the change',
  prompt: 'Implement it.',
  provider: 'spawn',
  preset: 'standard',
  model: 'mock-model',
  reasoningEffort: 'high',
  maxTokens: 4_000,
  timeoutMs: 30_000,
  readOnly: true,
  writeScopes: ['src'],
}

describe('fleet member migration', () => {
  it('migrates a legacy spawn member to the Greeneek connection with a fresh Harmony lane', () => {
    expect(migrateFleetMember(MEMBER)).toEqual({
      ...MEMBER,
      provider: GREENEEK_HARNESS,
      context: 'fresh',
      execution: 'harmony',
    })
    expect(migrateFleetMember({ ...MEMBER, context: 'fresh' })).toEqual({
      ...MEMBER,
      provider: GREENEEK_HARNESS,
      context: 'fresh',
      execution: 'harmony',
    })
  })

  it('keeps a stored fork context on a legacy spawn member, requesting the seeding strategy', () => {
    expect(migrateFleetMember({ ...MEMBER, context: 'fork' })).toEqual({
      ...MEMBER,
      provider: GREENEEK_HARNESS,
      context: 'fork',
      execution: 'harmony',
    })
  })

  it('migrates a legacy fork member to the explicit seeding context it actually ran', () => {
    const forked = { ...MEMBER, provider: 'fork' }
    expect(migrateFleetMember(forked)).toEqual({
      ...forked,
      provider: GREENEEK_HARNESS,
      context: 'fork',
      execution: 'harmony',
    })
    // The fork backend seeds whenever completed turns exist, so a stored
    // `fresh` context never described its run; migration records the effect.
    expect(migrateFleetMember({ ...forked, context: 'fresh' })).toEqual({
      ...forked,
      provider: GREENEEK_HARNESS,
      context: 'fork',
      execution: 'harmony',
    })
  })

  it('passes external and already-migrated members through by reference', () => {
    const external = { ...MEMBER, provider: 'claude-code', execution: 'melody' as const }
    expect(migrateFleetMember(external)).toBe(external)
    const migrated = { ...MEMBER, provider: GREENEEK_HARNESS, execution: 'harmony' as const, context: 'fresh' as const }
    expect(migrateFleetMember(migrated)).toBe(migrated)
    const unbranded = { ...MEMBER, provider: 'deployment-acp' }
    expect(migrateFleetMember(unbranded)).toBe(unbranded)
  })

  it('is idempotent across every legacy strategy name', () => {
    for (const strategy of LEGACY_GREENEEK_STRATEGIES) {
      const once = migrateFleetMember({ ...MEMBER, provider: strategy })
      expect(migrateFleetMember(once)).toBe(once)
    }
  })
})

describe('fleet settings migration', () => {
  it('migrates every favorite while keeping unrelated configuration intact', () => {
    const settings: FleetSettings = {
      favorites: [
        {
          id: 'development',
          name: 'Development',
          enabled: false,
          concurrency: 2,
          members: [MEMBER, { ...MEMBER, name: 'verifier', provider: 'fork' }],
        },
        {
          id: 'external',
          name: 'External',
          members: [{ ...MEMBER, name: 'coder', provider: 'claude-code' }],
        },
      ],
    }
    const migrated = migrateFleetSettings(settings)
    expect(migrated.favorites[0]).toEqual({
      ...settings.favorites[0],
      members: [
        { ...MEMBER, provider: GREENEEK_HARNESS, context: 'fresh', execution: 'harmony' },
        { ...MEMBER, name: 'verifier', provider: GREENEEK_HARNESS, context: 'fork', execution: 'harmony' },
      ],
    })
    expect(migrated.favorites[1]).toBe(settings.favorites[1])
    expect(migrateFleetSettings(migrated)).toBe(migrated)
  })

  it('returns the same section when no member names a legacy strategy', () => {
    const settings: FleetSettings = {
      favorites: [{ id: 'clean', name: 'Clean', members: [{ ...MEMBER, provider: GREENEEK_HARNESS }] }],
    }
    expect(migrateFleetSettings(settings)).toBe(settings)
    expect(migrateFleetSettings({ favorites: [] })).toEqual({ favorites: [] })
  })
})

describe('user-facing connection identity', () => {
  it('presents Greeneek strategies as their Harness connection and keeps other names', () => {
    expect(userFacingConnection('fork')).toBe(GREENEEK_HARNESS)
    expect(userFacingConnection('spawn')).toBe(GREENEEK_HARNESS)
    expect(userFacingConnection(GREENEEK_HARNESS)).toBe(GREENEEK_HARNESS)
    expect(userFacingConnection('claude-code')).toBe('claude-code')
    expect(userFacingConnection('deployment-acp')).toBe('deployment-acp')
  })
})

/**
 * Fleet domain layer: enabled gate, timeout resolution, duplication, and starter
 * templates. These are the pure rules the Team service enforces at launch, so
 * each case pins the value a saved fleet carries rather than a UI rendering.
 */
import { describe, expect, it } from 'vitest'
import {
  duplicateFleetFavorite,
  fleetStarterTemplates,
  FLEET_STARTER_TEMPLATES,
  isFleetEnabled,
  starterFleet,
  validateFleetSettings,
  type FleetFavorite,
} from '../src/fleet-settings.ts'

/** One fleet with explicit settings, so each assertion changes exactly one field. */
function fleet(overrides: Partial<FleetFavorite> = {}): FleetFavorite {
  return {
    id: 'review',
    name: 'Review',
    members: [{ name: 'reviewer', description: 'review', prompt: 'Review it.', provider: 'spawn' }],
    ...overrides,
  }
}

describe('fleet enabled gate', () => {
  it('treats an absent flag as enabled so saved fleets keep launching', () => {
    expect(isFleetEnabled(fleet())).toBe(true)
    expect(isFleetEnabled(fleet({ enabled: true }))).toBe(true)
    expect(isFleetEnabled(fleet({ enabled: false }))).toBe(false)
  })
})

describe('fleet duplication', () => {
  it('copies under a fresh id and a marked name, leaving the source alone', () => {
    const source = fleet()
    const copy = duplicateFleetFavorite(source, new Set([source.id]))
    expect(copy.id).toBe('review-copy')
    expect(copy.name).toBe('Review (copy)')
    expect(copy.members[0]).toEqual(source.members[0])
    expect(copy.members[0]).not.toBe(source.members[0])
  })

  it('walks the suffix until the id is free', () => {
    const copy = duplicateFleetFavorite(fleet(), new Set(['review', 'review-copy', 'review-copy-2']))
    expect(copy.id).toBe('review-copy-3')
  })
})

describe('starter fleets', () => {
  it('ships Development, Research, and QA as editable member lists', () => {
    expect(FLEET_STARTER_TEMPLATES.map(template => template.id))
      .toEqual(['development', 'research', 'quality-assurance'])
    for (const template of FLEET_STARTER_TEMPLATES) {
      expect(template.members.length).toBeGreaterThan(1)
      expect(() => { validateFleetSettings({ favorites: [template] }) }).not.toThrow()
    }
  })

  it('installs under its own id when free and under a copy id when taken', () => {
    expect(starterFleet('research', new Set()).id).toBe('research')
    expect(starterFleet('research', new Set(['research'])).id).toBe('research-copy')
  })

  it('hands the preview surface copies it cannot mutate back into the catalog', () => {
    const offered = fleetStarterTemplates()
    expect(offered.map(template => template.id))
      .toEqual(['development', 'research', 'quality-assurance'])
    // Identity, not equality: a caller that edited what it was shown must not reach
    // the templates every later install copies from.
    expect(offered[0]).not.toBe(FLEET_STARTER_TEMPLATES[0])
    expect(offered[0]!.members[0]).not.toBe(FLEET_STARTER_TEMPLATES[0]!.members[0])
    expect(starterFleet('development', new Set()).members[0]).not.toBe(FLEET_STARTER_TEMPLATES[0]!.members[0])
  })

  it('names the available template ids when asked for one that does not exist', () => {
    expect(() => starterFleet('deploy', new Set()))
      .toThrow('no starter fleet template named "deploy"; available: development, research, quality-assurance')
  })
})

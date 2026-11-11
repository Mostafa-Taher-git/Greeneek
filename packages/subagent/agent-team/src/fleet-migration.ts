/**
 * Read-time migration of saved fleet members from internal execution-strategy
 * registry names to the Greeneek Harness connection, plus the identity mapping
 * shared by the host launcher, the Team tools, and the browser settings page.
 * Pure data: no registry or host imports, so browser faces run the same rules.
 * @module @greeneek/gnk-agent-team/fleet-migration
 */

import type { FleetFavoriteMember, FleetSettings } from './fleet-settings.ts'

/** Harness implementation identity of the in-harness Greeneek runtime. */
export const GREENEEK_HARNESS = 'greeneek'

/**
 * Shipped registry names of the Greeneek execution strategies. Saved fleets and
 * deployment configs name them directly; the migration recognizes them without
 * a live registry, so a stored fleet stays readable in any composition.
 */
export const LEGACY_GREENEEK_STRATEGIES: readonly string[] = ['fork', 'spawn']

/**
 * User-facing connection identity for one registry name. Greeneek execution
 * strategies present as their Harness connection; every other registry name is
 * already the connection a deployment configured.
 * @param registryName - provider registration name.
 * @returns the connection identity shown to users and models.
 */
export function userFacingConnection(registryName: string): string {
  return LEGACY_GREENEEK_STRATEGIES.includes(registryName) ? GREENEEK_HARNESS : registryName
}

/**
 * Normalize one saved member to the Harness connection vocabulary without
 * changing how it executes.
 *
 * `fork` becomes the Greeneek connection with an explicit `fork` context: the
 * fork backend seeds the parent's completed turns whenever they exist, so a
 * stored `fresh` context never described its run. `spawn` becomes the Greeneek
 * connection keeping its stored context, absent reading as `fresh`: the spawn
 * backend starts fresh, and a stored `fork` context was refused at launch, so
 * the migrated member requests the seeding strategy the user asked for. Both
 * strategies hold durable lanes, so the migrated execution type is `harmony`.
 * Members naming any other connection pass through unchanged.
 * @param member - one stored fleet member, in any shipped format.
 * @returns the migrated member, or the same value when nothing changes.
 */
export function migrateFleetMember(member: FleetFavoriteMember): FleetFavoriteMember {
  if (member.provider === 'fork') {
    return { ...member, provider: GREENEEK_HARNESS, context: 'fork', execution: 'harmony' }
  }
  if (member.provider === 'spawn') {
    return { ...member, provider: GREENEEK_HARNESS, context: member.context ?? 'fresh', execution: 'harmony' }
  }
  return member
}

/**
 * Migrate every favorite of one stored fleet section. The settings bytes keep
 * their legacy values until a user save writes the migrated view back, so no
 * silent disk write and no configuration loss; launch and editing read the
 * migrated form, and the migration is idempotent.
 * @param settings - the stored fleet section, in any shipped format.
 * @returns the migrated section, or the same value when nothing changes.
 */
export function migrateFleetSettings(settings: FleetSettings): FleetSettings {
  const favorites = settings.favorites.map((favorite) => {
    const members = favorite.members.map(member => migrateFleetMember(member))
    const membersChanged = members.some((migrated, index) => migrated !== favorite.members[index])
    return membersChanged ? { ...favorite, members } : favorite
  })
  const settingsChanged = favorites.some((favorite, index) => favorite !== settings.favorites[index])
  return settingsChanged ? { ...settings, favorites } : settings
}

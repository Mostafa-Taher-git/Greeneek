/**
 * Fleet favorites stored in the `fleet` settings namespace, plus the
 * provider-availability vocabulary shared by the Lead tools and Web Settings.
 * A favorite is validated on save, revalidated at launch, and never falls back
 * to a different provider.
 * @module @greeneek/gnk-agent-team/fleet-settings
 */

import z from '@greeneek/schemastery'
import { errorMessage, TeamError } from './error.ts'
import { resolveLanePolicy } from './lane-policy.ts'
import type { SpawnAgentOptions, SpawnTeammateRequest, TeamMemberView } from './types.ts'

/** Settings namespace owning named fleet favorites. */
export const FLEET_SETTINGS_NAMESPACE = 'fleet'

/** Honest provider availability states exposed to the Fleet settings page. */
export type FleetProviderState =
  | 'not-installed'
  | 'unauthenticated'
  | 'unsupported-version'
  | 'ready'
  | 'temporarily-unavailable'

/** One configured provider's current availability. */
export interface FleetProviderAvailability {
  /** Registry or configured provider name. */
  readonly name: string
  /** Honest state derived without launching a paid or state-changing run. */
  readonly state: FleetProviderState
  /** Whether the provider can hold a durable Team lane. */
  readonly continuable: boolean
  /** Human-readable reason for a non-ready state. */
  readonly detail?: string
}

/** One member of a named fleet favorite. */
export interface FleetFavoriteMember {
  readonly name: string
  readonly description: string
  readonly prompt: string
  readonly provider: string
  readonly context?: 'fresh' | 'fork'
  readonly preset?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly readOnly?: boolean
  readonly writeScopes?: string[]
  readonly maxTokens?: number
}

/** One named fleet favorite. */
export interface FleetFavorite {
  /** Stable lower-kebab-case identity. */
  readonly id: string
  /** Display name shown in Settings. */
  readonly name: string
  readonly members: FleetFavoriteMember[]
}

/** Complete user-writable fleet settings section. */
export interface FleetSettings {
  readonly favorites: FleetFavorite[]
}

/** The fleet section with its schema defaults resolved. */
export interface FleetFavoritesView {
  readonly providers: FleetProviderAvailability[]
  readonly favorites: FleetFavorite[]
  readonly revision: number
}

/** One favorite mutation result; conflicts stay business results. */
export type FleetFavoriteResult =
  | { readonly ok: true; readonly value: FleetFavoritesView }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One favorite launch result; provider and confirmation refusals stay business results. */
export type FleetLaunchResult =
  | { readonly ok: true; readonly value: { readonly members: TeamMemberView[] } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

const FAVORITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const memberSchema = z.object({
  name: z.string().required(),
  description: z.string().required(),
  prompt: z.string().required(),
  provider: z.string().required(),
  context: z.union(['fresh', 'fork'] as const),
  preset: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  readOnly: z.boolean(),
  writeScopes: z.array(z.string()),
  maxTokens: z.number().step(1).min(1),
})

const favoriteSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
  members: z.array(memberSchema).required(),
})

/** Settings schema for the complete fleet section. */
export const FleetSettingsSchema: z<FleetSettings> = z.object({
  favorites: z.array(favoriteSchema).default([]),
})

/**
 * Validate one favorite's domain rules beyond the settings schema.
 * @param favorite - schema-valid favorite.
 * @throws {TeamError} `TEAM_FLEET_FAVORITE_INVALID` naming the rejected field.
 */
export function validateFleetFavorite(favorite: FleetFavorite): void {
  if (!FAVORITE_ID.test(favorite.id) || favorite.id.length > 64) {
    throw new TeamError(
      `fleet favorite id ${JSON.stringify(favorite.id)} must be lower-kebab-case and at most 64 characters`,
      'TEAM_FLEET_FAVORITE_INVALID',
    )
  }
  if (favorite.name.trim().length === 0) {
    throw new TeamError('fleet favorite name must be non-empty', 'TEAM_FLEET_FAVORITE_INVALID')
  }
  if (favorite.members.length === 0) {
    throw new TeamError(`fleet favorite "${favorite.id}" needs at least one member`, 'TEAM_FLEET_FAVORITE_INVALID')
  }
  const names = new Set<string>()
  for (const member of favorite.members) {
    if (!MEMBER_NAME.test(member.name) || member.name.length > 64 || member.name === 'lead') {
      throw new TeamError(
        `fleet favorite "${favorite.id}" member name ${JSON.stringify(member.name)} must be lower-kebab-case, at most 64 characters, and not "lead"`,
        'TEAM_FLEET_FAVORITE_INVALID',
      )
    }
    if (names.has(member.name)) {
      throw new TeamError(
        `fleet favorite "${favorite.id}" repeats member "${member.name}"`,
        'TEAM_FLEET_FAVORITE_INVALID',
      )
    }
    names.add(member.name)
    if (member.description.trim().length === 0 || member.prompt.trim().length === 0) {
      throw new TeamError(
        `fleet favorite "${favorite.id}" member "${member.name}" needs a description and prompt`,
        'TEAM_FLEET_FAVORITE_INVALID',
      )
    }
    if (member.provider.trim().length === 0) {
      throw new TeamError(
        `fleet favorite "${favorite.id}" member "${member.name}" needs a provider`,
        'TEAM_FLEET_FAVORITE_INVALID',
      )
    }
    try {
      resolveLanePolicy({
        ...member.readOnly !== true ? {} : { readOnly: true },
        ...member.writeScopes === undefined || member.writeScopes.length === 0
          ? {}
          : { writeScopes: member.writeScopes },
      })
    } catch (error: unknown) {
      throw new TeamError(
        `fleet favorite "${favorite.id}" member "${member.name}" has an invalid lane policy: ${errorMessage(error)}`,
        'TEAM_FLEET_FAVORITE_INVALID',
        { cause: error },
      )
    }
  }
}

/**
 * Validate the complete fleet section, including unique favorite ids.
 * @param settings - schema-resolved section.
 * @throws {TeamError} `TEAM_FLEET_FAVORITE_INVALID` for any invalid favorite or duplicate id.
 */
export function validateFleetSettings(settings: FleetSettings): void {
  const ids = new Set<string>()
  for (const favorite of settings.favorites) {
    validateFleetFavorite(favorite)
    if (ids.has(favorite.id)) {
      throw new TeamError(`fleet favorite id "${favorite.id}" is duplicated`, 'TEAM_FLEET_FAVORITE_INVALID')
    }
    ids.add(favorite.id)
  }
}

/**
 * Build honest availability rows for this deployment's configured providers.
 * A provider that cannot hold a durable lane is reported as unsupported, and
 * a configured but unregistered provider as not installed; no probe launches a
 * paid or state-changing run.
 * @param configured - provider names this deployment expects for fleets.
 * @param providers - currently registered provider names.
 * @param continuable - names of providers that can hold a durable lane.
 * @returns one row per distinct configured or registered provider.
 */
export function fleetProviderAvailability(
  configured: readonly string[],
  providers: readonly string[],
  continuable: ReadonlySet<string>,
): FleetProviderAvailability[] {
  const names = [...new Set([...configured, ...providers])].sort()
  return names.map((name) => {
    if (!providers.includes(name)) {
      return {
        name,
        state: 'not-installed',
        continuable: false,
        detail: 'provider is not registered in this composition',
      }
    }
    if (!continuable.has(name)) {
      return {
        name,
        state: 'unsupported-version',
        continuable: false,
        detail: 'provider cannot hold a durable Team lane',
      }
    }
    return { name, state: 'ready', continuable: true }
  })
}

/**
 * Build one teammate start request from a stored favorite member.
 * @param member - validated favorite member.
 * @returns the spawn request without its caller cancellation.
 */
export function favoriteMemberRequest(member: FleetFavoriteMember): Omit<SpawnTeammateRequest, 'signal'> {
  const agentOptions: SpawnAgentOptions | undefined = member.model === undefined && member.reasoningEffort === undefined
    ? undefined
    : {
      ...member.model === undefined ? {} : { model: member.model },
      ...member.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: member.reasoningEffort as NonNullable<SpawnAgentOptions['reasoningEffort']> },
    }
  return {
    name: member.name,
    description: member.description,
    prompt: [{ type: 'text', text: member.prompt }],
    context: member.context ?? 'fresh',
    provider: member.provider,
    ...member.preset === undefined ? {} : { agentPreset: member.preset },
    ...agentOptions === undefined ? {} : { agentOptions },
    ...member.readOnly !== true ? {} : { readOnly: true },
    ...member.writeScopes === undefined || member.writeScopes.length === 0
      ? {}
      : { writeScopes: member.writeScopes },
    ...member.maxTokens === undefined ? {} : { maxTokens: member.maxTokens },
  }
}

/**
 * Refuse a favorite member whose provider is not ready, without substituting
 * another provider.
 * @param member - favorite member being launched.
 * @param providers - current availability rows.
 * @throws {TeamError} `TEAM_FLEET_PROVIDER_UNAVAILABLE` naming the provider and state.
 */
export function assertFavoriteProviderReady(
  member: FleetFavoriteMember,
  providers: readonly FleetProviderAvailability[],
): void {
  const provider = providers.find(candidate => candidate.name === member.provider)
  if (provider?.state === 'ready') return
  throw new TeamError(
    `fleet member "${member.name}" provider "${member.provider}" is ${provider?.state ?? 'not-installed'}; refusing to substitute another provider`,
    'TEAM_FLEET_PROVIDER_UNAVAILABLE',
  )
}

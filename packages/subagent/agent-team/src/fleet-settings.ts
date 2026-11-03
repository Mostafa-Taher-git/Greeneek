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
  | 'one-shot'
  | 'unauthenticated'
  | 'ready'
  | 'temporarily-unavailable'

/** One configured provider's current availability. */
export interface FleetProviderAvailability {
  /** Registry or configured provider name. */
  readonly name: string
  /** Honest state derived without launching a paid or state-changing run. */
  readonly state: FleetProviderState
  /** Whether the provider runs a delegated task to one result. */
  readonly oneShot: boolean
  /** Whether the provider holds a durable lane: mailbox, interrupt, and recovery. */
  readonly continuable: boolean
  /** Human-readable reason for a non-`ready` state. */
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
  /** False keeps the fleet saved but unlaunchable until it is enabled again. */
  readonly enabled?: boolean
  /**
   * Members launching at once. The default 1 is the sequential launch this
   * surface shipped with; a larger value starts members in batches of that size.
   */
  readonly concurrency?: number
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
  enabled: z.boolean(),
  concurrency: z.number().step(1).min(1),
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
 * Validate the complete fleet section: every favorite is valid and ids are unique.
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
 * A fleet with `enabled: false` stays saved and refuses to launch.
 * @param favorite - one stored fleet favorite.
 * @returns whether the launcher may start its members.
 */
export function isFleetEnabled(favorite: FleetFavorite): boolean {
  return favorite.enabled !== false
}

/**
 * Members the launcher may start at once; 1 keeps the sequential launch.
 * @param favorite - one stored fleet favorite.
 * @returns how many of its members a batch launch admits concurrently.
 */
export function fleetConcurrency(favorite: FleetFavorite): number {
  return favorite.concurrency ?? 1
}

/**
 * Copy one fleet under a fresh identity, ready for editing.
 * @param favorite - fleet being duplicated.
 * @param existingIds - ids already saved, so the copy never collides.
 * @returns the duplicate with `-copy` and `-copy-2`, `-copy-3` … suffixes as needed.
 */
export function duplicateFleetFavorite(favorite: FleetFavorite, existingIds: ReadonlySet<string>): FleetFavorite {
  const baseId = `${favorite.id}-copy`
  let suffix = 2
  let id = baseId
  while (existingIds.has(id)) {
    id = `${baseId}-${String(suffix)}`
    suffix += 1
  }
  return {
    ...favorite,
    id,
    name: `${favorite.name} (copy)`,
    members: favorite.members.map(member => ({ ...member })),
  }
}

/**
 * Starter fleets, shipped as editable copies rather than fixed configuration:
 * installing one returns a favorite the user can rename, re-member, and delete.
 */
export const FLEET_STARTER_TEMPLATES: readonly FleetFavorite[] = [
  {
    id: 'development',
    name: 'Development',
    members: [
      { name: 'implementer', description: 'write the change', prompt: 'Implement the requested change in the workspace.', provider: 'spawn' },
      { name: 'verifier', description: 'run the checks', prompt: 'Run the tests and checks for the change just made and report the exact output.', provider: 'spawn', readOnly: true },
    ],
  },
  {
    id: 'research',
    name: 'Research',
    members: [
      { name: 'investigator', description: 'read the codebase', prompt: 'Investigate the question and cite the files that answer it.', provider: 'spawn', readOnly: true },
      { name: 'synthesiser', description: 'summarise findings', prompt: 'Summarise the investigation into the decisions it constrains.', provider: 'spawn', readOnly: true },
    ],
  },
  {
    id: 'quality-assurance',
    name: 'QA',
    members: [
      { name: 'test-author', description: 'write tests', prompt: 'Write the tests that cover the requested behaviour.', provider: 'spawn' },
      { name: 'test-runner', description: 'execute tests', prompt: 'Execute the test suite and report every failure with its output.', provider: 'spawn', readOnly: true },
    ],
  },
]

/**
 * One starter template as an editable saved fleet under its template id.
 * @param id - template identity.
 * @param existingIds - ids already saved.
 * @returns the installable fleet copy.
 * @throws {TeamError} `TEAM_FLEET_TEMPLATE_UNKNOWN` for an id with no template.
 */
export function starterFleet(id: string, existingIds: ReadonlySet<string>): FleetFavorite {
  const template = FLEET_STARTER_TEMPLATES.find(candidate => candidate.id === id)
  if (template === undefined) {
    throw new TeamError(
      `no starter fleet template named ${JSON.stringify(id)}; available: ${FLEET_STARTER_TEMPLATES.map(candidate => candidate.id).join(', ')}`,
      'TEAM_FLEET_TEMPLATE_UNKNOWN',
    )
  }
  const taken = existingIds.has(template.id) ? duplicateFleetFavorite(template, existingIds) : template
  return { ...taken, members: taken.members.map(member => ({ ...member })) }
}

/**
 * Build honest availability rows for this deployment's configured providers.
 * Every registered provider runs a one-shot delegation, so only the durable-lane
 * capability separates `ready` from `one-shot`, and a configured but unregistered
 * provider is `not-installed`. No probe launches a paid or state-changing run.
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
        oneShot: false,
        continuable: false,
        detail: 'provider is not registered in this composition',
      }
    }
    if (!continuable.has(name)) {
      return {
        name,
        state: 'one-shot',
        oneShot: true,
        continuable: false,
        detail: 'provider runs one delegation to a result and holds no durable Team lane',
      }
    }
    return { name, state: 'ready', oneShot: true, continuable: true }
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
 * Refuse a favorite member whose provider cannot run it, without substituting
 * another provider. A one-shot provider is admitted: the roster settles its run
 * and refuses interactive operations on it. An isolated write scope needs the
 * durable lane that only a continuable provider has, so that shape is refused.
 * @param member - favorite member being launched.
 * @param providers - current availability rows.
 * @throws {TeamError} `TEAM_FLEET_PROVIDER_UNAVAILABLE` naming the provider, its state, and the reason.
 */
export function assertFavoriteProviderReady(
  member: FleetFavoriteMember,
  providers: readonly FleetProviderAvailability[],
): void {
  const provider = providers.find(candidate => candidate.name === member.provider)
  if (provider === undefined || !provider.oneShot) {
    throw new TeamError(
      `fleet member "${member.name}" provider "${member.provider}" is ${provider?.state ?? 'not-installed'}; refusing to substitute another provider`,
      'TEAM_FLEET_PROVIDER_UNAVAILABLE',
    )
  }
  if (provider.continuable || member.writeScopes === undefined || member.writeScopes.length === 0) return
  throw new TeamError(
    `fleet member "${member.name}" declares an isolated write scope, but provider "${member.provider}" is one-shot and has no durable lane to checkpoint`,
    'TEAM_FLEET_PROVIDER_UNAVAILABLE',
  )
}

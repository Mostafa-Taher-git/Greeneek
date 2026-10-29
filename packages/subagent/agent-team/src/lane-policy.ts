/**
 * Lane write policy: which teammates share the Lead checkout and which get an
 * isolated worktree with disjoint write scopes.
 * @module @greeneek/gnk-agent-team/lane-policy
 */

import { TeamError } from './error.ts'
import { scopesOverlap, writeScope } from './validation.ts'

/**
 * How one teammate may touch the workspace:
 *
 * - `shared` keeps the pre-lane behavior: the teammate runs in the Lead
 *   checkout with no write restriction beyond the deployment's file policy.
 * - `read-only` runs in the Lead checkout with file and Git mutations denied.
 * - `isolated` runs in its own lane worktree with a declared, disjoint write
 *   scope set; only the Lead integrates its checkpointed patch.
 */
export type LanePolicy =
  | { readonly kind: 'shared' }
  | { readonly kind: 'read-only' }
  | { readonly kind: 'isolated'; readonly writeScopes: readonly string[] }

/** Lane fields accepted by one teammate start. */
export interface LanePolicyRequest {
  /** Run the teammate without write or Git-mutation tools. */
  readonly readOnly?: boolean
  /** Workspace-relative prefixes the teammate may change in its own worktree. */
  readonly writeScopes?: readonly string[]
}

/** One active isolated lane's identity and declared scopes. */
export interface ActiveLaneScope {
  /** Teammate name owning the lane. */
  readonly lane: string
  /** Normalized workspace-relative write prefixes. */
  readonly writeScopes: readonly string[]
}

/**
 * Resolve and validate one teammate's lane policy before any child or
 * worktree exists. An isolated lane requires a positive scope set, which makes
 * the Lead state what the lane may change instead of inferring it later.
 * @param request - lane fields from the spawn request.
 * @returns the resolved policy; `shared` when no lane field is present.
 * @throws {TeamError} `TEAM_INVALID_LANE_POLICY` for contradictory or empty lane fields.
 */
export function resolveLanePolicy(request: LanePolicyRequest): LanePolicy {
  const scopes = request.writeScopes
  if (request.readOnly === true && scopes !== undefined) {
    throw new TeamError('readOnly and writeScopes are mutually exclusive', 'TEAM_INVALID_LANE_POLICY')
  }
  if (scopes !== undefined) {
    if (scopes.length === 0) {
      throw new TeamError('an isolated lane requires at least one write scope', 'TEAM_INVALID_LANE_POLICY')
    }
    return Object.freeze({
      kind: 'isolated',
      writeScopes: Object.freeze([...new Set(scopes.map(writeScope))]),
    })
  }
  if (request.readOnly === true) return Object.freeze({ kind: 'read-only' })
  return Object.freeze({ kind: 'shared' })
}

/**
 * Fail when one lane's declared write scopes overlap another active lane's.
 * Isolated lanes edit copies of the same repository, so the scopes only stay
 * meaningful when the Lead splits the work before either lane starts.
 * @param candidate - lane name and normalized scopes being admitted.
 * @param active - lanes already holding a checkout for the same Lead.
 * @throws {TeamError} `TEAM_LANE_SCOPE_OVERLAP` naming the conflicting lane and prefixes.
 */
export function assertDisjointLaneScopes(
  candidate: ActiveLaneScope,
  active: readonly ActiveLaneScope[],
): void {
  for (const lane of active) {
    if (lane.lane === candidate.lane) continue
    for (const left of candidate.writeScopes) {
      for (const right of lane.writeScopes) {
        if (scopesOverlap(left, right)) {
          throw new TeamError(
            `lane "${candidate.lane}" scope "${left}" overlaps lane "${lane.lane}" scope "${right}"`,
            'TEAM_LANE_SCOPE_OVERLAP',
          )
        }
      }
    }
  }
}

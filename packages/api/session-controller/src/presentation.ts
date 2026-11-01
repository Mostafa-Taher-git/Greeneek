/**
 * The Session's tool-presentation opt-in and its durable reconstruction.
 *
 * `both` is a user opt-in, never a composition default: the Session
 * Controller owns the single Remote that applies it once to the live agent's
 * own scope through `ctx.tools.presentAs('both')`, logging the declaration as
 * a `tool/present-as` event. This unit folds those declarations into the
 * `presentAs` Session projection so a resumed process re-declares silently
 * before the agent publishes, exactly the way the preset identity
 * reconstructs. Preset composition rows declare through the same `presentAs`
 * effect at mount, so their presentation reconstructs when the composition
 * remounts, and this projection stays null for them — it exists for opt-ins
 * that no composition carries.
 * @module
 */

import type { Context } from '@greeneek/cordis'
import type { SessionEvent } from '@greeneek/gnk-session'
import type { ProjectionDefinition } from '@greeneek/gnk-session-projection'
import { z } from 'zod'

/** One Session's presentation: the user opt-in, or null when none has declared. */
export type ToolPresentationProjectionState = 'native' | 'ptc' | 'both' | null

const toolPresentationSchema = z.union([
  z.literal('native'),
  z.literal('ptc'),
  z.literal('both'),
  z.literal(null),
]) as unknown as z.ZodType<ToolPresentationProjectionState>

/**
 * Advance the Session presentation by one Session event.
 * @param state - presentation state before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced presentation state.
 */
function applyToolPresentation(
  state: ToolPresentationProjectionState,
  event: SessionEvent,
): ToolPresentationProjectionState {
  if (event.type !== 'tool/present-as') return state
  return event.data.to
}

/** Current Session presentation, advanced by opt-in declaration events. */
export const toolPresentationProjectionDefinition = {
  key: 'presentAs',
  stateSchema: toolPresentationSchema,
  init: () => null,
  apply: applyToolPresentation,
  wire: { viewSchema: toolPresentationSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'presentAs', ToolPresentationProjectionState>

/**
 * Register the presentation projection with the session-projection registry.
 * @param ctx - the host Session Controller context.
 */
export function installToolPresentationProjection(ctx: Context): void {
  ctx.sessionProjections.register(toolPresentationProjectionDefinition)
}

/**
 * How to withdraw the presentation each agent scope declared through a user
 * call. `ctx.tools.presentAs` is turn-1-final by design, so reversing it means
 * running the exact disposer it returned — which also removes the SDK and
 * collapse prompt sections that declaration mounted. A composition's own
 * declaration never enters here, so the chip cannot withdraw a preset's choice.
 */
const liveDeclarations = new WeakMap<object, () => void>()

/**
 * Remember how to withdraw one scope's user declaration.
 * @param scope - the agent's own context, the identity the declaration covers.
 * @param dispose - the exact disposer `ctx.tools.presentAs` returned.
 */
export function rememberPresentation(scope: object, dispose: () => void): void {
  liveDeclarations.set(scope, dispose)
}

/**
 * Withdraw one scope's user declaration, if this process holds one.
 * @param scope - the agent's own context.
 * @returns true when a live declaration was released.
 */
export function releasePresentation(scope: object): boolean {
  const dispose = liveDeclarations.get(scope)
  if (dispose === undefined) return false
  liveDeclarations.delete(scope)
  dispose()
  return true
}

/**
 * Whether this process holds a user declaration for one scope. A lock refusal
 * with a held declaration is a repeat of the same request; a refusal without
 * one belongs to a composition the chip must not reverse.
 * @param scope - the agent's own context.
 * @returns true when a user declaration is live.
 */
export function holdsPresentation(scope: object): boolean {
  return liveDeclarations.has(scope)
}

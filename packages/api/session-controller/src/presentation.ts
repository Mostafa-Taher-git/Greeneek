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

/**
 * Durable Tool event vocabulary shared with type-only consumers.
 *
 * @module @greeneek/gnk-tools/types
 */

import type { ToolCallId } from '@greeneek/gnk-llm/brand'
import type { ContentBlock } from '@greeneek/gnk-llm/types'

/** Payload recorded when one nested PTC mode Tool dispatch starts. */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
}

/** Payload recorded when one nested PTC mode Tool dispatch settles. */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
}

/** Payload recorded when one scope declares the presentation its model sees. */
export interface ToolPresentationEventData {
  /**
   * The presentation now active for that scope — the same vocabulary as
   * `ToolPresentationMode` in this package's index, typed inline as a string
   * union so this durable log vocabulary imports nothing.
   */
  to: 'native' | 'ptc' | 'both'
}

declare module '@greeneek/gnk-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the deterministic sub-call id (`<parent>:code:<n>`,
     * numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/code-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/code-dispatch-start': PtcDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/code-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * model-facing outcome in `tool/result`'s own vocabulary
     * (`content` + `isError`), so UIs render a sub-call through the exact
     * code path that renders a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/code-dispatch': PtcDispatchEventData
    /**
     * One scope changed its tool presentation: the per-session `both` opt-in
     * calls `ctx.tools.presentAs('both')` on the agent's own scope, and its
     * withdrawal calls `presentAs('native')` after running that declaration's
     * disposer. `to` is the presentation that scope's model sees from the
     * recording turn on. The user's own declaration is reversible; any
     * declaration the Session Controller does not own — a preset composition's
     * standing one above all — stays turn-1-final, and the presentation lock
     * answers a later re-declare of that scope with the typed
     * `PRESENTATION_LOCKED` refusal while logging nothing. Only a change the
     * Session Controller accepted appends, so a session log carries one event
     * per accepted toggle and replays to the last recorded presentation; a
     * composition mount has none so it stays silent there, and a resumed
     * process re-declares silently from the recorded projection. Log-only:
     * `deriveMessages()` ignores it; UIs pair it
     * with the agent's presentation chip for live state and with the
     * `request/header` series the declaration reopens on resume.
     */
    'tool/present-as': ToolPresentationEventData
  }
}

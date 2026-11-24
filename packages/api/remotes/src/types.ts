/**
 * Type face of the forwarded-Host-event allowlist: the consumer key projection
 * and the selection seat it fills. The allowlist VALUE lives in
 * `./remote-events.ts`, keeping this module type-only per the package
 * convention; both compiler faces list both files, so the Host forwarding loop
 * and the consumer `ctx.remote.$on` key face read one declaration instead of
 * two copies that could drift.
 *
 * @module @greeneek/gnk-api-remotes/types
 */

import type { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

/** Type projection of the allowlist; the consumer and the Host read this one. */
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]['event']

declare module '@greeneek/gnk-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}

  interface RemoteErrorDetailsMap {
    /** No flow claims the requested key, or it offers no such method. */
    'authorization/no-flow': { readonly key: string; readonly method?: string }
    /** An attempt for the key is already running. */
    'authorization/in-flight': { readonly key: string }
    /** The answered prompt is not, or is no longer, in flight. */
    'authorization/no-prompt': { readonly key: string; readonly promptId: string }
    /** The flow's own attempt failed; the message is the seam's. */
    'authorization/failed': { readonly key: string; readonly message: string }
    /** Every settings refusal that is not a stale write. */
    'settings/rejected': { readonly ns: string }
    /** The stored revision moved after the caller read it. */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /** The provider refused a valid credential write; details name only the reference. */
    'credential/rejected': { readonly ref: string }
  }
}

/**
 * Remote-face failure vocabulary of the wave engine. A module of its own so
 * the browser face (`./client.ts`) can load it without dragging the host
 * graph: every other wave module imports the seam's runtime types, and a
 * client program that pulls them in collides its `Context.sessions` merge
 * with the controller client face's.
 *
 * @module @greeneek/gnk-subagent-wave/remote-codes
 */

declare module '@greeneek/gnk-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No retained wave carries the addressed id. */
    'wave/not-found': { readonly waveId: string }
    /** The addressed wave retains no member with that id. */
    'wave/member-not-found': { readonly waveId: string; readonly memberId: string }
    /** The addressed wave cannot be resumed: not closed, not budget-interrupted, already resumed, or no explicit budget. */
    'wave/not-resumable': { readonly waveId: string }
  }
}

// The augmentation above needs this file to be a module; a script file would
// turn `declare module` into a shadowing ambient declaration.
export {}

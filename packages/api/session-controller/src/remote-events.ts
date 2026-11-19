/** Session Controller events available to a Remote Event assembly. */
type SessionControllerRemoteEvent =
  | 'browser/surface'
  | 'api-session/activity'
  | 'api-session/added'
  | 'api-session/error'
  | 'api-session/removed'
  | 'api-session/status'

declare module '@greeneek/gnk-typert-protocol' {
  interface TypertRemoteEventSelection extends
    Record<SessionControllerRemoteEvent, true> {}
}

export {}

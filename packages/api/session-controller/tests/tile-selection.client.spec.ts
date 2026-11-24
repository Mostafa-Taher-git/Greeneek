// @vitest-environment jsdom
/** A tiled pane scopes its persisted session selection by tile id. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import type { SessionId } from '@greeneek/gnk-api-remotes/client'
import { ClientSessions } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote } from './fake-api.client.ts'

const sid = (s: string): SessionId => s as SessionId

afterEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('ClientSessions tile selection', () => {
  it('reads ?tile and ?session into a pane-scoped persisted key', () => {
    window.history.replaceState({}, '', '/?tile=tile-01&session=tile-session')
    new ClientSessions(new Context(), fakeRemote(new FakeApiClient()))
    const persisted = localStorage.getItem('gnk.sessions.tile.tile-01')
    expect(persisted).not.toBeNull()
    expect(JSON.parse(persisted ?? '{}')).toMatchObject({ sessionId: sid('tile-session') })
    expect(localStorage.getItem('gnk.sessions.current')).toBeNull()
  })

  it('keeps the ordinary page selection untouched', () => {
    const svc = new ClientSessions(new Context(), fakeRemote(new FakeApiClient()))
    expect(svc.list.getSnapshot().current).toBeUndefined()
    expect(localStorage.getItem('gnk.sessions.tile.tile-01')).toBeNull()
    expect(svc.list.getSnapshot().current).toBeUndefined()
  })
})

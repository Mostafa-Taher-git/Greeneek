import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import type { CredentialRef } from '@greeneek/gnk-credentials/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import { DiscordSource, GithubSource, SourceRegistry, isBot } from '../src/index.ts'
import type { FetchLike } from '../src/index.ts'

const dirs: string[] = []
const stores: DeepAgentStore[] = []
function store(): DeepAgentStore {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-sources-'))
  dirs.push(dir)
  const instance = new DeepAgentStore(join(dir, 'deep-agent.sqlite'))
  stores.push(instance)
  return instance
}
afterEach(() => {
  for (const instance of stores.splice(0)) instance.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function host(token = 'test-token'): Context {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: vi.fn(async () => ({ value: token })),
  } as never)
  return ctx
}

const response = (status: number, body: unknown): Awaited<ReturnType<FetchLike>> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

describe('actor filtering', () => {
  it('refuses bots and CI authors', () => {
    expect(isBot('renovate[bot]', 'User')).toBe(true)
    expect(isBot('someone', 'Bot')).toBe(true)
    expect(isBot(undefined, 'User')).toBe(true)
    expect(isBot('alice', 'User')).toBe(false)
  })
})

describe('GitHub source', () => {
  it('ingests issues, filters bots and persists a read cursor', async () => {
    const db = store()
    const fetchImpl = vi.fn(async () => response(200, [
      {
        number: 7, title: 'Build fails', updated_at: '2026-01-02T00:00:00Z', html_url: 'https://github.com/o/r/issues/7',
        user: { login: 'alice', type: 'User' },
      },
      {
        number: 8, title: 'Bot noise', updated_at: '2026-01-03T00:00:00Z',
        user: { login: 'ci[bot]', type: 'User' },
      },
    ]))
    const source = new GithubSource(host(), db, {
      tokenRef: 'GITHUB_TOKEN' as CredentialRef,
      repositories: ['o/r'], pollSeconds: 60, allowed: ['alice'],
    }, fetchImpl)
    const triggers = await source.poll()
    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toMatchObject({ source: 'github', text: 'Build fails' })
    expect(triggers[0]?.threads).toEqual([{ source: 'github', id: 'o/r#7' }])
    expect(db.getSetting('github.since.o/r')).toBe('2026-01-03T00:00:00Z')
    expect(source.health().ingested).toBe(1)
  })

  it('posts an idempotency-marked reply and reports gone channels', async () => {
    const db = store()
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
      expect(init?.body).toContain('<!-- gnk-deep-agent:reply-1 -->')
      return response(201, {})
    })
    const source = new GithubSource(host(), db, {
      tokenRef: 'GITHUB_TOKEN' as CredentialRef, repositories: ['o/r'], pollSeconds: 60, allowed: [],
    }, fetchImpl)
    expect(await source.send({ id: 'reply-1', text: 'done', address: { repository: 'o/r', number: '7' } })).toBe('sent')
  })
})

describe('Discord source', () => {
  it('ingests guild messages, filters bot authors and correlates threads', async () => {
    const db = store()
    const fetchImpl = vi.fn(async () => response(200, [
      {
        id: '200', content: 'please fix this', timestamp: '2026-01-01T00:00:00Z',
        author: { id: 'u1', bot: false },
        message_reference: { message_id: '150' },
      },
      { id: '201', content: 'bot noise', timestamp: '2026-01-01T00:00:01Z', author: { id: 'b1', bot: true } },
    ]))
    const source = new DiscordSource(host(), db, {
      tokenRef: 'DISCORD_BOT_TOKEN' as CredentialRef,
      channels: ['c1'], guildId: 'g1', pollSeconds: 60, allowed: ['u1'],
    }, fetchImpl)
    const triggers = await source.poll()
    expect(triggers).toHaveLength(1)
    expect(triggers[0]?.threads).toEqual([{ source: 'discord', id: 'c1:150' }])
    expect(db.getSetting('discord.after.c1')).toBe('201')
    expect(source.health().lastError).toBeUndefined()
  })

  it('posts replies with the reply id in the body', async () => {
    const db = store()
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
      expect(init?.body).toContain('discord-reply-1')
      return response(200, {})
    })
    const source = new DiscordSource(host(), db, {
      tokenRef: 'DISCORD_BOT_TOKEN' as CredentialRef,
      channels: ['c1'], guildId: 'g1', pollSeconds: 60, allowed: [],
    }, fetchImpl)
    expect(await source.send({ id: 'discord-reply-1', text: 'done', address: { source: 'discord', channel: 'c1' } })).toBe('sent')
  })
})

describe('reply reliability', () => {
  it('backs off a failed reply before retrying', async () => {
    const db = store()
    let calls = 0
    const adapter = new GithubSource(host(), db, {
      tokenRef: 'GITHUB_TOKEN' as CredentialRef, repositories: [], pollSeconds: 60, allowed: [],
    }, vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('network down')
      return response(201, {})
    }))
    const registry = new SourceRegistry([adapter], vi.fn(), 10)
    registry.enqueueReply({ id: 'r1', text: 'one', address: { repository: 'o/r', number: '7' }, source: 'github' })
    await registry.pollOnce()
    expect(registry.pending()).toBe(1)
    await registry.pollOnce()
    expect(registry.pending()).toBe(1)
    await new Promise((resolve) => { setTimeout(resolve, 15) })
    await registry.pollOnce()
    expect(registry.pending()).toBe(0)
    expect(calls).toBe(2)
  })
})

describe('SourceRegistry', () => {
  it('deduplicates queued replies and clears them after delivery', async () => {
    const db = store()
    const adapter = new GithubSource(host(), db, {
      tokenRef: 'GITHUB_TOKEN' as CredentialRef, repositories: [], pollSeconds: 60, allowed: [],
    }, vi.fn(async () => response(200, [])))
    const registry = new SourceRegistry([adapter], vi.fn())
    registry.enqueueReply({ id: 'r1', text: 'one', address: { repository: 'o/r', number: '7' }, source: 'github' })
    registry.enqueueReply({ id: 'r1', text: 'one', address: { repository: 'o/r', number: '7' }, source: 'github' })
    expect(registry.pending()).toBe(1)
    await registry.pollOnce()
    expect(registry.pending()).toBe(0)
  })
})

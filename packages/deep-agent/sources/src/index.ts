/**
 * Deep-agent source adapters. GitHub and Discord events become domain Triggers
 * with deterministic ids and durable read cursors; replies go back through
 * the same Source with idempotency keys. Credentials are resolved per call
 * from Greeneek's credential service and never leave the Host process.
 */
import type { Context } from '@greeneek/cordis'
import type { CredentialRef } from '@greeneek/gnk-credentials/types'
// Type-only: merges ctx.credentials for per-operation token resolution.
import type {} from '@greeneek/gnk-credentials'
import { key } from '@greeneek/gnk-deep-agent-core'
import type { Trigger } from '@greeneek/gnk-deep-agent-core'
import type { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'

/** Minimal fetch seam; tests inject a scripted transport. */
export type FetchLike = (url: string, init: {
  readonly headers: Readonly<Record<string, string>>
  readonly method?: string
  readonly body?: string
  readonly signal?: AbortSignal
}) => Promise<{
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}>

export type { SourceHealth } from './types.ts'
import type { SourceHealth } from './types.ts'

/** One source adapter. */
export interface SourceAdapter {
  readonly kind: string
  poll(): Promise<readonly Trigger[]>
  send(message: { readonly id: string; readonly text: string; readonly address: Readonly<Record<string, string>> }): Promise<'sent' | 'gone'>
  health(): SourceHealth
}

const header = (token: string): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json, application/json',
  'user-agent': 'greeneek-deep-agent',
})

/** Build a health record for one adapter. */
function healthOf(kind: string, lastPollAt: string | undefined, lastError: string | undefined, ingested: number): SourceHealth {
  return {
    kind,
    ...(lastPollAt === undefined ? {} : { lastPollAt }),
    ...(lastError === undefined ? {} : { lastError }),
    ingested,
  }
}

/**
 * True for bot or CI-authored events; these never grant explicit authority.
 * @param login - author login to inspect.
 * @param type - author account type reported by the Source.
 * @returns true when the author is a bot or has no login.
 */
export function isBot(login: string | undefined, type: string | undefined): boolean {
  return type === 'Bot' || login === undefined || login.endsWith('[bot]')
}

/**
 * Shared credential, health and cursor bookkeeping for REST-backed sources.
 * Each source supplies its own kind, fetch semantics and row normalization.
 */
abstract class PolledSource {
  protected lastPollAt: string | undefined
  protected lastError: string | undefined
  protected ingested = 0
  abstract readonly kind: string

  protected constructor(
    protected readonly ctx: Context,
    protected readonly store: DeepAgentStore,
    protected readonly tokenRef: CredentialRef,
    protected readonly tokenLabel: string,
  ) {}

  /** Current health of this adapter. */
  health(): SourceHealth {
    return healthOf(this.kind, this.lastPollAt, this.lastError, this.ingested)
  }

  protected async token(): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(this.tokenRef)
    if (resolved?.value === undefined || resolved.value === '') throw new Error(`${this.tokenLabel}: no token configured`)
    return resolved.value
  }

  protected saveCursor(cursorKey: string, newest: string, previous: string | undefined): void {
    if (newest !== '' && newest !== previous) this.store.setSetting(cursorKey, newest)
  }

  /** Run one cursor-scoped page, recording its cursor and any transport failure. */
  protected async runPoll(cursorKey: string, previous: string | undefined, work: () => Promise<string>): Promise<void> {
    try {
      this.saveCursor(cursorKey, await work(), previous)
    } catch (error: unknown) {
      this.recordPollError(error)
    }
  }

  protected recordPollError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error)
  }

  protected finishPoll<T>(triggers: readonly T[]): readonly T[] {
    this.lastPollAt = new Date().toISOString()
    this.ingested += triggers.length
    return triggers
  }
}

/** GitHub issue and comment ingestion. */
export class GithubSource extends PolledSource implements SourceAdapter {
  readonly kind = 'github'
  private readonly config: {
    readonly tokenRef: CredentialRef
    readonly repositories: readonly string[]
    readonly pollSeconds: number
    readonly allowed: readonly string[]
  }
  private readonly fetchImpl: FetchLike

  /**
 * @param ctx - Host context for credential resolution.
 * @param store - durable cursor store.
 * @param config - source config.
 * @param fetchImpl - injectable transport.
 */
  constructor(
    ctx: Context,
    store: DeepAgentStore,
    config: GithubSource['config'],
    fetchImpl: FetchLike = globalThis.fetch,
  ) {
    super(ctx, store, config.tokenRef, 'github')
    this.config = config
    this.fetchImpl = fetchImpl
  }

  /** Poll each configured repository once and normalize new events. */
  async poll(): Promise<readonly Trigger[]> {
    const token = await this.token()
    const triggers: Trigger[] = []
    for (const repository of this.config.repositories) {
      const cursorKey = `github.since.${repository}`
      const since = this.store.getSetting(cursorKey) as string | undefined
      const url = new URL(`https://api.github.com/repos/${repository}/issues`)
      url.searchParams.set('state', 'all')
      url.searchParams.set('sort', 'updated')
      url.searchParams.set('per_page', '50')
      if (since !== undefined) url.searchParams.set('since', since)
      await this.runPoll(cursorKey, since, async () => {
        const response = await this.fetchImpl(url.href, { headers: header(token) })
        if (!response.ok) throw new Error(`github: HTTP ${response.status}`)
        const rows = await response.json() as Array<Record<string, unknown>>
        let newest = since ?? ''
        for (const row of rows) {
          const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : ''
          if (updatedAt > newest) newest = updatedAt
          const user = row.user as Record<string, unknown> | undefined
          const login = typeof user?.login === 'string' ? user.login : undefined
          if (login !== undefined && isBot(login, typeof user?.type === 'string' ? user.type : undefined)) continue
          if (login !== undefined && this.config.allowed.length > 0 && !this.config.allowed.includes(login)) continue
          const number = Number(row.number)
          const id = key('github-issue', repository, number, updatedAt)
          const title = typeof row.title === 'string' ? row.title : ''
          const htmlUrl = typeof row.html_url === 'string' ? row.html_url : undefined
          triggers.push({
            id, source: 'github',
            threads: [{ source: 'github', id: `${repository}#${number}` }],
            actor: { source: 'github', id: login ?? 'unknown' },
            human: true,
            at: updatedAt, text: title,
            ...(htmlUrl === undefined ? {} : { url: htmlUrl }),
            channel: { source: 'github', thread: `${repository}#${number}`, address: { repository, number: String(number) } },
            meta: {},
          })
        }
        this.saveCursor(cursorKey, newest, since)
        return newest
      })
    }
    const collected: readonly Trigger[] = triggers
    return this.finishPoll(collected)
  }

  /** Post an idempotent comment on the originating issue. */
  async send(message: { readonly id: string; readonly text: string; readonly address: Readonly<Record<string, string>> }): Promise<'sent' | 'gone'> {
    const token = await this.token()
    const repository = message.address.repository
    const number = message.address.number
    if (repository === undefined || number === undefined) return 'gone'
    const response = await this.fetchImpl(`https://api.github.com/repos/${repository}/issues/${number}/comments`, {
      method: 'POST',
      headers: { ...header(token), 'content-type': 'application/json' },
      body: JSON.stringify({ body: `<!-- gnk-deep-agent:${message.id} -->\n${message.text}` }),
    })
    if (response.status === 410 || response.status === 404) return 'gone'
    if (!response.ok) throw new Error(`github reply: HTTP ${response.status}`)
    return 'sent'
  }
}

/** Discord guild channel ingestion through the bot REST API. */
export class DiscordSource extends PolledSource implements SourceAdapter {
  readonly kind = 'discord'
  private readonly config: {
    readonly tokenRef: CredentialRef
    readonly channels: readonly string[]
    readonly guildId: string
    readonly pollSeconds: number
    readonly allowed: readonly string[]
  }
  private readonly fetchImpl: FetchLike

  /**
 * @param ctx - Host context for credential resolution.
 * @param store - durable cursor store.
 * @param config - source config.
 * @param fetchImpl - injectable transport.
 */
  constructor(
    ctx: Context,
    store: DeepAgentStore,
    config: DiscordSource['config'],
    fetchImpl: FetchLike = globalThis.fetch,
  ) {
    super(ctx, store, config.tokenRef, 'discord')
    this.config = config
    this.fetchImpl = fetchImpl
  }

  /** Poll each configured channel after its durable cursor. */
  async poll(): Promise<readonly Trigger[]> {
    const token = await this.token()
    const triggers: Trigger[] = []
    for (const channel of this.config.channels) {
      const cursorKey = `discord.after.${channel}`
      const after = this.store.getSetting(cursorKey) as string | undefined
      const url = new URL(`https://discord.com/api/v10/channels/${channel}/messages`)
      url.searchParams.set('limit', '50')
      if (after !== undefined) url.searchParams.set('after', after)
      await this.runPoll(cursorKey, after, async () => {
        const response = await this.fetchImpl(url.href, {
          headers: { authorization: `Bot ${token}`, accept: 'application/json', 'user-agent': 'greeneek-deep-agent' },
        })
        if (!response.ok) throw new Error(`discord: HTTP ${response.status}`)
        const rows = await response.json() as Array<Record<string, unknown>>
        let newest = after ?? ''
        for (const row of rows) {
          const id = typeof row.id === 'string' ? row.id : ''
          if (id > newest) newest = id
          const author = row.author as Record<string, unknown> | undefined
          const authorId = typeof author?.id === 'string' ? author.id : ''
          if (author?.bot === true || authorId === '') continue
          if (this.config.allowed.length > 0 && !this.config.allowed.includes(authorId)) continue
          const threadId = typeof row.thread_id === 'string' ? row.thread_id : undefined
          const parentId = typeof row.message_reference === 'object' && row.message_reference !== null
            ? (row.message_reference as Record<string, unknown>).message_id
            : undefined
          const correlation = threadId ?? (typeof parentId === 'string' ? parentId : id)
          triggers.push({
            id: key('discord-message', channel, id),
            source: 'discord',
            threads: [{ source: 'discord', id: `${channel}:${correlation}` }],
            actor: { source: 'discord', id: authorId },
            human: true,
            at: typeof row.timestamp === 'string' ? row.timestamp : new Date().toISOString(),
            text: typeof row.content === 'string' ? row.content : '',
            channel: { source: 'discord', thread: `${channel}:${correlation}`, address: { channel, guild: this.config.guildId } },
            meta: {},
          })
        }
        this.saveCursor(cursorKey, newest, after)
        return newest
      })
    }
    return this.finishPoll(triggers)
  }

  /** Post an idempotent reply in the originating channel or thread. */
  async send(message: { readonly id: string; readonly text: string; readonly address: Readonly<Record<string, string>> }): Promise<'sent' | 'gone'> {
    const token = await this.token()
    const channel = message.address.channel
    if (channel === undefined) return 'gone'
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${channel}/messages`, {
      method: 'POST',
      headers: { authorization: `Bot ${token}`, 'content-type': 'application/json', 'user-agent': 'greeneek-deep-agent' },
      body: JSON.stringify({ content: `[${message.id}] ${message.text}`.slice(0, 2_000) }),
    })
    if (response.status === 404 || response.status === 403) return 'gone'
    if (!response.ok) throw new Error(`discord reply: HTTP ${response.status}`)
    return 'sent'
  }
}

/** Poll adapters on their configured interval and dispatch Triggers and replies. */
export class SourceRegistry {
  private readonly adapters: SourceAdapter[]
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly pendingReplies: Array<{
    readonly id: string
    readonly text: string
    readonly address: Readonly<Record<string, string>>
    readonly source: string
    attempts: number
    retryAt: number
  }> = []
  private readonly backoffMs: number

  /**
   * @param adapters - the configured source adapters.
   * @param ingest - domain ingestion callback.
   * @param backoffMs - base delay before retrying a failed reply.
   */
  constructor(
    adapters: readonly SourceAdapter[],
    private readonly ingest: (trigger: Trigger) => void,
    backoffMs = 5_000,
  ) {
    this.adapters = [...adapters]
    this.backoffMs = backoffMs
  }

  /**
   * Current health of every configured adapter.
   * @returns one health record per adapter.
   */
  health(): readonly SourceHealth[] {
    return this.adapters.map(adapter => adapter.health())
  }

  /**
   * Queue a durable outbound reply.
   * @param reply - reply id, text, address, and Source name.
   */
  enqueueReply(reply: {
    readonly id: string
    readonly text: string
    readonly address: Readonly<Record<string, string>>
    readonly source: string
  }): void {
    if (this.pendingReplies.some(item => item.id === reply.id)) return
    this.pendingReplies.push({
      id: reply.id, text: reply.text, address: reply.address,
      source: reply.source, attempts: 0, retryAt: 0,
    })
  }

  /** Poll all adapters once and deliver queued replies. */
  async pollOnce(): Promise<void> {
    for (const adapter of this.adapters) {
      for (const trigger of await adapter.poll()) this.ingest(trigger)
    }
    for (let index = this.pendingReplies.length - 1; index >= 0; index -= 1) {
      const reply = this.pendingReplies[index]
      if (reply === undefined || reply.retryAt > Date.now()) continue
      const adapter = this.adapters.find(item => item.kind === reply.source)
      if (adapter === undefined) { this.pendingReplies.splice(index, 1); continue }
      try {
        await adapter.send(reply)
        this.pendingReplies.splice(index, 1)
      } catch {
        reply.attempts += 1
        reply.retryAt = Date.now() + this.backoffMs * 2 ** Math.min(reply.attempts - 1, 6)
      }
    }
  }

  /**
   * Start periodic polling; callers own shutdown.
   * @param intervalMs - poll interval in milliseconds.
   * @returns a disposer that stops the timer.
   */
  start(intervalMs: number): () => void {
    if (this.timer !== undefined) return () => { /* already started */ }
    this.timer = setInterval(() => { void this.pollOnce() }, intervalMs)
    return () => { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined }
  }

  /**
   * Number of queued outbound replies.
   * @returns the pending reply count.
   */
  pending(): number { return this.pendingReplies.length }
}

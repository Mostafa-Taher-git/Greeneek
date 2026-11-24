/**
 * Durable effect queue for Deep-agent. Effect rows live in the authoritative
 * store, so a restart continues pending work. Rows are coalesced by (kind,key),
 * ordered, retried with bounded exponential backoff, and removed only at commit.
 */
import type { EffectRow, DeepAgentStore } from '@greeneek/gnk-deep-agent-store'

/** The six reference effect kinds. */
export type EffectKind = 'assessment' | 'launch' | 'delivery' | 'stop' | 'retry' | 'relay' | 'notice' | 'reply'

/** Payloads carried by each kind, kept JSON-shaped for the wire and store. */
export interface EffectPayloads {
  assessment: { readonly triggerId: string }
  launch: { readonly ticketId: string; readonly assignmentId: string }
  delivery: { readonly ticketId: string; readonly assignmentId?: string; readonly inputIds?: readonly string[] }
  stop: { readonly ticketId: string; readonly assignmentId: string; readonly reason: string }
  retry: { readonly ticketId: string; readonly attempts: number }
  relay: { readonly text: string }
  notice: { readonly value: string; readonly summary: string }
  reply: { readonly id?: string }
}

/** A handler returns void on success, `Later` to defer without a failure, or throws to retry. */
export class Later extends Error {
  constructor(message = 'effect deferred') {
    super(message)
    this.name = 'Later'
  }
}

/** Handler registered for one effect kind; `Later` defers, a throw retries. */
export type EffectHandler<K extends EffectKind> = (value: EffectPayloads[K]) => void | Promise<void>

/** Retry policy for one kind. */
export interface RetryPolicy {
  readonly baseMs: number
  readonly maxMs: number
  readonly tries: number
  /** Ordered kinds block behind their oldest row; quiet kinds hide health errors. */
  readonly ordered?: boolean
  readonly quiet?: boolean
}

/** Default backoff and ordering policy for each effect kind. */
export const DEFAULT_RETRIES: Readonly<Record<EffectKind, RetryPolicy>> = {
  assessment: { baseMs: 2_000, maxMs: 60_000, tries: 8 },
  launch: { baseMs: 5_000, maxMs: 300_000, tries: 3 },
  delivery: { baseMs: 2_000, maxMs: 60_000, tries: 8, quiet: true },
  stop: { baseMs: 1_000, maxMs: 10_000, tries: 5 },
  retry: { baseMs: 15_000, maxMs: 120_000, tries: 3, quiet: true },
  relay: { baseMs: 2_000, maxMs: 60_000, tries: 8, ordered: true },
  notice: { baseMs: 2_000, maxMs: 60_000, tries: 8, ordered: true },
  reply: { baseMs: 5_000, maxMs: 300_000, tries: 8 },
}

const isoAfter = (ms: number): string => new Date(Date.now() + ms).toISOString()

/** The effect dispatcher. One drain at a time; work is bounded by a per-kind limit. */
export class Effects {
  private readonly handlers = new Map<EffectKind, (value: unknown) => void | Promise<void>>()
  private draining = false
  private scheduled = false

  /** @param store - the authoritative Deep-agent store. @param retries - per-kind retry policy. */
  constructor(
    private readonly store: DeepAgentStore,
    private readonly retries: Readonly<Record<EffectKind, RetryPolicy>> = DEFAULT_RETRIES,
  ) {}

  /**
   * Register the handler for one kind.
   * @param kind - effect kind to handle.
   * @param handler - callback invoked with the decoded payload.
   * @returns a disposer that removes this handler.
   */
  on<K extends EffectKind>(kind: K, handler: EffectHandler<K>): () => void {
    this.handlers.set(kind, handler as (value: unknown) => void | Promise<void>)
    return () => { if (this.handlers.get(kind) === handler) this.handlers.delete(kind) }
  }

  /**
   * Queue or coalesce one effect; its queue position is preserved.
   * @param kind - effect kind to queue.
   * @param key - coalescing key within the kind.
   * @param value - JSON-shaped payload for the handler.
   * @param due - earliest ISO time to run; defaults to now.
   */
  enqueue<K extends EffectKind>(kind: K, key: string, value: EffectPayloads[K], due = isoAfter(0)): void {
    this.store.enqueueEffect(kind, key, value, due)
    this.kick()
  }

  /**
   * Whether an effect is queued for a kind and key.
   * @param kind - effect kind to inspect.
   * @param key - coalescing key within the kind.
   * @returns true while a matching row is stored.
   */
  pending(kind: EffectKind, key: string): boolean {
    return this.store.dueEffects(kind, 1_000, '9999-12-31T00:00:00.000Z').some(row => row.kind === kind && row.key === key)
  }

  /** Wake the dispatcher after an external event; coalesces repeated calls. */
  kick(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; void this.drain() })
  }

  /**
   * Run all due effects, one at a time per ordered kind.
   * @param now - ISO cutoff for considering rows due; defaults to now.
   */
  async drain(now = isoAfter(0)): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (const kind of Object.keys(this.retries) as EffectKind[]) {
        const policy = this.retries[kind]
        const handler = this.handlers.get(kind)
        if (handler === undefined) continue
        const rows = this.store.dueEffects(kind, policy.ordered ? 1 : 16, now)
        for (const row of rows) await this.run(kind, row, handler, policy)
      }
    } finally {
      this.draining = false
    }
  }

  private async run(
    kind: EffectKind,
    row: EffectRow,
    handler: (value: unknown) => void | Promise<void>,
    policy: RetryPolicy,
  ): Promise<void> {
    const value = JSON.parse(row.value) as unknown
    try {
      await handler(value)
      this.store.deleteEffect(kind, row.key, row.seq, row.generation)
    } catch (error: unknown) {
      if (error instanceof Later) {
        this.store.deferEffect(kind, row.key, row.seq, row.generation, error.message, isoAfter(policy.baseMs))
        return
      }
      const attempts = row.attempts + 1
      if (attempts >= policy.tries) {
        this.store.deleteEffect(kind, row.key, row.seq, row.generation)
        return
      }
      const delay = Math.min(policy.maxMs, policy.baseMs * 2 ** attempts)
      const message = error instanceof Error ? error.message : String(error)
      this.store.failEffect(kind, row.key, row.seq, row.generation, message, isoAfter(delay))
    }
  }
}

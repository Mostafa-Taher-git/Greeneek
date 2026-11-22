/** In-memory repositories mirroring the Store's order and nested rollback. Used by the Engine and domain tests. */
import type { Decision, Thread, Ticket, Trigger, TriggerDisposition } from './types.ts'
import type { Repositories } from './ports.ts'

type Table<T> = Map<string, T>

interface Snapshot {
  readonly triggers: readonly [string, Trigger][]
  readonly dispositions: readonly [string, TriggerDisposition][]
  readonly threads: readonly [string, Thread][]
  readonly tickets: readonly [string, Ticket][]
  readonly decisions: readonly [string, Decision][]
  readonly pendingCount: number
}

/** Copy a stored record so callers cannot mutate repository state in place. */
function copy<T>(value: T): T {
  return structuredClone(value)
}

/** In-memory implementation of the write-side Repositories port. */
export class MemoryRepositories implements Repositories {
  private triggersTable: Table<Trigger> = new Map()
  private dispositionsTable: Table<TriggerDisposition> = new Map()
  private threadsTable: Table<Thread> = new Map()
  private ticketsTable: Table<Ticket> = new Map()
  private decisionsTable: Table<Decision> = new Map()
  private depth = 0
  private stack: Snapshot[] = []
  private pending: Array<() => void> = []

  private snapshot(): Snapshot {
    return {
      triggers: [...this.triggersTable],
      dispositions: [...this.dispositionsTable],
      threads: [...this.threadsTable],
      tickets: [...this.ticketsTable],
      decisions: [...this.decisionsTable],
      pendingCount: this.pending.length,
    }
  }

  private restore(snapshot: Snapshot): void {
    this.triggersTable = new Map(snapshot.triggers)
    this.dispositionsTable = new Map(snapshot.dispositions)
    this.threadsTable = new Map(snapshot.threads)
    this.ticketsTable = new Map(snapshot.tickets)
    this.decisionsTable = new Map(snapshot.decisions)
    this.pending.length = snapshot.pendingCount
  }

  /** Run a function in a transaction; nested transactions roll back independently. Callbacks run only after the outermost commit. */
  atomic<T>(fn: () => T): T {
    this.stack.push(this.snapshot())
    this.depth += 1
    try {
      const result = fn()
      this.depth -= 1
      if (this.depth === 0) {
        const callbacks = this.pending
        this.pending = []
        this.stack.pop()
        for (const callback of callbacks) callback()
      }
      return result
    } catch (error: unknown) {
      this.depth -= 1
      const snapshot = this.stack.pop()
      if (snapshot !== undefined) this.restore(snapshot)
      if (this.depth === 0) this.pending = []
      throw error
    }
  }

  afterCommit(fn: () => void): void {
    if (this.depth === 0) fn()
    else this.pending.push(fn)
  }

  readonly triggers = {
    get: (id: string): Trigger | undefined => {
      const value = this.triggersTable.get(id)
      return value === undefined ? undefined : copy(value)
    },
    save: (trigger: Trigger): void => { this.triggersTable.set(trigger.id, copy(trigger)) },
    disposition: (id: string): TriggerDisposition | undefined => {
      const value = this.dispositionsTable.get(id)
      return value === undefined ? undefined : copy(value)
    },
    saveDisposition: (id: string, value: TriggerDisposition): void => { this.dispositionsTable.set(id, copy(value)) },
  }

  readonly threads = {
    get: (key: string): Thread | undefined => {
      const value = this.threadsTable.get(key)
      return value === undefined ? undefined : copy(value)
    },
    save: (thread: Thread): void => { this.threadsTable.set(thread.key, copy(thread)) },
    list: (): readonly Thread[] => [...this.threadsTable.values()].map(copy),
    active: (): readonly Thread[] => [...this.threadsTable.values()]
      .filter(thread => thread.pending.length > 0 || thread.evaluating !== undefined)
      .map(copy),
  }

  readonly tickets = {
    get: (id: string): Ticket | undefined => {
      const value = this.ticketsTable.get(id)
      return value === undefined ? undefined : copy(value)
    },
    save: (ticket: Ticket): void => { this.ticketsTable.set(ticket.id, copy(ticket)) },
    list: (): readonly Ticket[] => [...this.ticketsTable.values()].map(copy),
    open: (): readonly Ticket[] => [...this.ticketsTable.values()].filter(ticket => ticket.ended === undefined).map(copy),
    active: (): readonly Ticket[] => [...this.ticketsTable.values()]
      .filter(ticket => ticket.ended === undefined || ticket.undelivered.length > 0)
      .map(copy),
  }

  readonly decisions = {
    get: (id: string): Decision | undefined => {
      const value = this.decisionsTable.get(id)
      return value === undefined ? undefined : copy(value)
    },
    save: (decision: Decision): void => { this.decisionsTable.set(decision.id, copy(decision)) },
    byThread: (key: string): readonly Decision[] => [...this.decisionsTable.values()]
      .filter(decision => decision.threadKey === key)
      .map(copy),
  }
}

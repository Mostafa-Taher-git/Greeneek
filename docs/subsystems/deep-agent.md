# Deep-agent

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdeepagent--deepagentservice"></a>

### `ctx.deepAgent` — `DeepAgentService`

The Deep-agent runtime service.

```ts cordis-catalog
/** Resume Workers whose assignments were running before this boot. */
async recover(): Promise<void>

/**
 * Current Worker capacity from the real slot registry.
 * @returns used and free slot counts.
 */
capacity(): { readonly used: number; readonly free: number }

/** Close the owned store; called by the Host effect disposer and by tests. */
close(): void

/**
 * Current operational state.
 * @returns the state summary.
 */
@Remote('state') state(): DeepAgentState

/**
 * All durable Tickets, newest last.
 * @returns compact Ticket rows.
 */
@Remote('tickets') tickets(): readonly TicketRow[]

/**
 * All recorded Decisions.
 * @returns compact Decision rows.
 */
@Remote('decisions') decisions(): readonly DecisionRow[]

/**
 * Recent Triggers with their dispositions.
 * @returns Trigger rows.
 */
@Remote('triggers') triggers(): readonly TriggerRow[]

/**
 * Stop a Ticket and withdraw its Mandate.
 * @param request - ticket id and optional reason.
 */
@Remote('stopTicket') stopTicket(request: { ticketId: string; reason?: string }): void

/**
 * Retry a blocked or failed Ticket under the same Mandate.
 * @param request - ticket id.
 */
@Remote('retryTicket') retryTicket(request: { ticketId: string }): void

/**
 * Host path of the domain database, for the deployment panel.
 * @returns the absolute database path.
 */
@Remote('databasePath') databasePath(): string

/**
 * Configured worker capacity.
 * @returns the maximum simultaneous workers.
 */
@Remote('maxWorkers') maxWorkers(): number

/**
 * Current Worker slot usage.
 * @returns used and free slot counts.
 */
@Remote('workerCapacity') workerCapacityState(): { readonly used: number; readonly free: number }
```

Source: [`packages/deep-agent/runtime/src/index.ts`](../../packages/deep-agent/runtime/src/index.ts)

<a id="deep-agent-events"></a>

### `deep-agent/*` events

<a id="deep-agentchanged--emit"></a>

#### `deep-agent/changed` — emit

Deep-agent operational state changed.

```ts cordis-catalog
/**
 * Deep-agent operational state changed.
 * @mode emit
 * @param state - the updated state summary.
 */
'deep-agent/changed'(state: { policyVersion: string; mode: string; counts: Readonly<Record<string, number>> }): void
```

Source: [`packages/api/session-controller/src/types.ts`](../../packages/api/session-controller/src/types.ts)

<a id="deep-agentchanged--emit"></a>

#### `deep-agent/changed` — emit

A Deep-agent domain record changed; listeners may refresh their view.

```ts cordis-catalog
/**
 * A Deep-agent domain record changed; listeners may refresh their view.
 * @mode emit
 * @param state - the current operational summary.
 */
'deep-agent/changed'(state: DeepAgentState): void
```

Source: [`packages/deep-agent/runtime/src/index.ts`](../../packages/deep-agent/runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->

Deep-agent is an independent proactive agent subsystem. It owns a Router session, Worker sessions, a domain model, an event engine, a SQLite persistence boundary, durable effects, GitHub and optional Feishu sources, and a management panel. It is separate from Maestro, Fleet, and the subagent capability seam.

## Domain and pipeline

The domain pipeline is Source → Trigger → Thread → Eval → Decision → Ticket → Assignment → Executor → Report/Channel. The event engine batches pending Triggers per Thread, admits them through a versioned Policy, records auditable Decisions, creates Tickets carrying immutable Mandates, and routes Work to isolated Workers. Subscription fan-out delivers follow-ups without granting new authority.

## Persistence and effects

Authoritative state lives in a dedicated SQLite database with a monotonic schema version, owner-only file creation, generated working-set columns, and SAVEPOINT-backed nested transactions. Effects (`assessment`, `launch`, `delivery`, `relay`, `notice`, `reply`) are durable rows with coalescing, bounded backoff, ordering, and outbox receipts.

## Current scope

The domain core, store, effects, policy, and Host runtime are implemented. Worker session execution, source adapters, and the management panel are added in later phases; until then the runtime exposes only real persisted operational state and read/control Remotes.

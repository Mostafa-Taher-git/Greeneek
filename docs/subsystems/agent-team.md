# Agent Teams


Types shared by the implicit-root Team domain, model tools, and host adapters. The [Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns identity, mailbox, task, and shared-checkout decisions; the [Team Steer messaging Agent Note](../../.agents/notes/implemented/simplification/2026-08-30-team-send-message-steer.md) owns message scheduling; this page records the literal durable forms from [`packages/subagent/agent-team/src/types.ts`](../../packages/subagent/agent-team/src/types.ts).

## Identity and roster

`TeamId` is the root `SessionId` under a distinct [brand](core.md#branded-ids). `TeamTaskId` is Team-local and monotonically allocated as `task-<n>`; `TeamMessageId` is globally random. A teammate's Session id remains its persistent identity, while `name` is an immutable model/UI label.

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
  /** The teammate runs without file-mutating or Git-mutating tools. */
  readonly readOnly?: boolean
  /** Workspace-relative prefixes of the teammate's isolated lane; absent for shared lanes. */
  readonly writeScopes?: readonly string[]
  /** Cumulative token ceiling checked at each step boundary; absent when unbudgeted. */
  readonly maxTokens?: number
}
```

Every member starts in `provisioning` and reaches exactly one terminal roster phase, `active` or `failed`. Runtime `running`/`idle`/`inactive` status is derived separately and never rewrites this record. `readOnly` marks a shared-checkout teammate whose file and Git mutation tools are denied; `writeScopes` marks an isolated worktree lane; `maxTokens` is a cumulative ceiling checked at each step boundary.

## Durable mailbox

The Lead Session first stores the complete queued message. A target receipt is acknowledged only after its pending inbox item or recorded user message is durable, leaving queued-minus-delivered as the recovery mailbox.

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}
```

Every message attempts Steer delivery. A running target receives it at the nearest step boundary, an idle target starts a turn, and an inactive teammate cold-resumes. Scheduling is not stored in the durable record because callers cannot select another mode.

The target Session keeps message identity and sender attribution on both the pending inbox item and the eventual user message. Folding that source across inbox and history is the target-side de-duplication key; the model-visible framing repeats the id and sender.

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## Shared task DAG

Every task event stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views add owner name, readiness, and write-scope overlap warnings without changing the durable snapshot.

## Lanes and integration

A write-scoped teammate starts in a lane worktree at `<gnkHome>/worktrees/<LeadSessionId>/<lane>`; its durable record, checkpoints, and approvals live under `<gnkHome>/lanes`. Active lanes must declare disjoint workspace-relative scopes. A teammate tool guard denies Git mutations, while integration independently verifies the lane `HEAD` still equals its recorded base. A checkpoint stages tracked and untracked changes into one patch and records its SHA-256 hash; integration applies only a checkpoint whose hash still matches the reviewed hash, to a clean primary checkout at the expected `HEAD`, then runs gates, commits, and removes the lane. A conflict, gate failure, or commit failure halts that Lead's queue and leaves the lane and checkpoint intact.

Lane records are durable JSON validated at the file boundary. `preparing` and `closing` records are the only stages startup recovery mutates; `ready` lanes keep unmerged work across idle, cold resume, and Team disposal. Disposal checkpoints ready lanes without deleting them.

Named fleet favorites live in the `fleet` settings namespace. A favorite holds an id, a display name, and members with provider, context, preset, model, reasoning effort, read-only flag, write scopes, and token ceiling. The settings owner fences writes by revision; a launch revalidates every provider and never substitutes one. Availability is derived from the live provider registry: `ready` only for a provider that can hold a durable lane, `unsupported-version` for a registered provider without that capability, and `not-installed` for a configured provider that is absent. No probe launches a paid or state-changing run.

A repository may declare `.gnk/fleet.json` with a strict `version` and `fleet.members` array. Parsing is size-capped and provider-limited to the deployment's in-process fleet providers. Launching requires a one-time approval keyed by the canonical repository path and the SHA-256 of the exact file bytes; changed bytes require fresh approval, and an admitted approval is removed.

## Replay

`foldTeam()` replays one root Session into the roster, task board, and queued-minus-delivered mailbox that every Team operation reads. It selects records by `TeamId`, so events inherited by an ordinary fork retain the ancestor id and never enter the new root's state. Session event `seq` and `time` remain the ordering and timing record; Team snapshots do not duplicate them. Roster and task reads reach callers as views; pending mail stays internal to delivery and recovery. The package [README](../../packages/subagent/agent-team/README.md) owns operation, authorization, recovery, and limit behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined

/**
 * Resolve one live teammate's durable lane policy for scoped tool guards.
 * @param agent - exact live Team member.
 * @returns the durable lane policy, or `shared` outside a teammate lane.
 */
lanePolicyFor(agent: Agent): LanePolicy

/**
 * List every durable lane record of one Team, including terminal lanes.
 * @param caller - exact live Team member.
 * @returns lane records ordered by lane name.
 */
async listLanes(caller: Agent): Promise<LaneRecord[]>

/**
 * Checkpoint one ready lane so its exact patch becomes integrable evidence.
 * Only the Team Lead may checkpoint.
 * @param caller - exact live Team member.
 * @param lane - durable lane name.
 * @param signal - cancellation for the patch copy.
 * @returns the checkpoint hash, path, and byte length.
 */
async checkpointLane(caller: Agent, lane: string, signal: AbortSignal): Promise<LaneCheckpoint>

/**
 * Explicitly discard one ready lane after preserving its checkpointed patch.
 * Only the Team Lead may discard.
 * @param caller - exact live Team member.
 * @param lane - durable lane name.
 * @param signal - cancellation for checkpoint and removal.
 * @returns the preserved checkpoint.
 */
async discardLane(caller: Agent, lane: string, signal: AbortSignal): Promise<LaneCheckpoint>

/**
 * Apply one reviewed lane patch, run its gates, commit it, and remove the
 * merged checkout. Only the Team Lead may integrate.
 * @param caller - exact live Team member.
 * @param request - lane, expected primary HEAD, reviewed hash, gates, and commit text.
 * @returns the primary commit and gate evidence.
 */
async integrateLane( caller: Agent, request: { readonly lane: string readonly expectedPrimaryHead: string readonly patchHash: string readonly gateCommands: readonly LaneGateCommand[] readonly commitMessage: string readonly signal: AbortSignal }, ): Promise<LaneMergeResult>

/**
 * Resume a Lead's halted merge queue after investigating the stopped lane.
 * @param caller - exact live Team member.
 */
resumeLaneQueue(caller: Agent): void

/**
 * Report why one Team's merge queue stopped.
 * @param caller - exact live Team member.
 * @returns the halting diagnostic, or undefined while the queue accepts lanes.
 */
laneQueueHaltReason(caller: Agent): string | undefined

/**
 * Read one repository fleet config without granting spend.
 * @param caller - exact live Team Lead.
 * @param signal - cancellation for path and file reads.
 * @returns the parsed config, exact bytes hash, and approval state.
 */
async readRepoFleet(caller: Agent, signal: AbortSignal): Promise<RepoFleetSnapshot>

/**
 * Approve the exact fleet bytes currently in the Lead repository.
 * @param caller - exact live Team Lead.
 * @param signal - cancellation for the read and approval write.
 * @returns the approved snapshot.
 */
async approveRepoFleet(caller: Agent, signal: AbortSignal): Promise<RepoFleetSnapshot>

/**
 * Consume one fleet approval and return the config it covers.
 * @param caller - exact live Team Lead.
 * @param signal - cancellation for the read and approval removal.
 * @returns the admitted configuration snapshot.
 */
async admitRepoFleet(caller: Agent, signal: AbortSignal): Promise<RepoFleetSnapshot>

/**
 * Report honest availability for every configured or registered fleet
 * provider without launching a paid or state-changing probe.
 * @param caller - exact live Team member.
 * @returns one row per provider, with ready only for continuable providers.
 */
fleetAvailability(caller: Agent): FleetProviderAvailability[]

/**
 * Read the fleet favorites section and current settings revision.
 * @param caller - exact live Team Lead.
 * @returns providers, favorites, and the revision for the next fenced write.
 */
fleetFavorites(caller: Agent): FleetFavoritesView

/**
 * Save one favorite by id, replacing a same-id favorite.
 * @param caller - exact live Team Lead.
 * @param favorite - complete favorite value.
 * @param expectedRevision - settings revision the editor read.
 * @returns the committed favorites view or a typed conflict.
 */
async saveFleetFavorite( caller: Agent, favorite: FleetFavorite, expectedRevision: number, ): Promise<FleetFavoriteResult>

/**
 * Delete one favorite by id.
 * @param caller - exact live Team Lead.
 * @param id - favorite identity.
 * @param expectedRevision - settings revision the editor read.
 * @returns the committed favorites view or a typed conflict.
 */
async deleteFleetFavorite( caller: Agent, id: string, expectedRevision: number, ): Promise<FleetFavoriteResult>

/**
 * Launch one saved favorite after an explicit confirmation, revalidating
 * every provider at use time and never substituting a different one.
 * @param caller - exact live Team Lead.
 * @param id - favorite identity.
 * @param confirmed - the UI's explicit confirmation; false starts nothing.
 * @returns created members or a typed refusal.
 */
async launchFleetFavorite(caller: Agent, id: string, confirmed: boolean): Promise<FleetLaunchResult>

/**
 * Read the current roster and non-deleted task board through the generated Remote API.
 * @param agent - exact live Team member used as the authority credential.
 * @returns detached current roster and task views.
 */
@Remote('view') remoteView(agent: Agent): TeamView

/**
 * Create one shared task through the generated Remote API.
 * @param agent - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task or a typed Team rejection.
 */
@Remote('createTask') remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult>

/**
 * Apply one task mutation and preserve Team rejections as business results.
 * @param agent - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed task or a typed Team rejection.
 */
@Remote('updateTask') remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult>

/**
 * Read provider availability through the generated Remote API.
 * @returns honest provider availability rows.
 */
@Remote('fleetAvailability') remoteFleetAvailability(): FleetProviderAvailability[]

/**
 * Launch one favorite through the generated Remote API.
 * @param agent - exact live Team Lead.
 * @param id - favorite identity.
 * @param confirmed - explicit UI confirmation.
 * @returns created members or a typed refusal.
 */
@Remote('launchFleetFavorite') remoteLaunchFleetFavorite(agent: Agent, id: string, confirmed: boolean): Promise<FleetLaunchResult>
```

Types: [Agent](core.md)

Source: [`packages/subagent/agent-team/src/index.ts`](../../packages/subagent/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->

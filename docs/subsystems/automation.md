# Automation tasks

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationservice"></a>

### `ctx.automation` — `AutomationService`

The automation service: durable task execution, scheduling, and history.

```ts cordis-catalog
/**
 * All tasks.
 * @returns the current task catalog.
 */
@Remote('list') list(): AutomationCatalog

/**
 * Create one task.
 * @param request - title, instruction, target and timing.
 * @returns the created task.
 */
@Remote('create') create(request: AutomationCreateRequest): AutomationTask

/**
 * Update task status with optimistic concurrency.
 * @param request - task id, expected revision and optional new status.
 * @returns the updated task after execution has settled.
 */
@Remote('edit') edit(request: AutomationEditRequest): AutomationTask

/**
 * Execute the instruction in an owned session and return the persisted task.
 * @param request - task id.
 * @returns the updated task after execution has settled.
 */
@Remote('run') async run(request: AutomationTaskRequest): Promise<AutomationTask>

/**
 * Delete a task.
 * @param request - task id.
 * @returns the remaining task catalog.
 */
@Remote('delete') delete(request: AutomationTaskRequest): AutomationCatalog
```

Source: [`packages/automation/automation/src/index.ts`](../../packages/automation/automation/src/index.ts)

<a id="automation-events"></a>

### `automation/*` events

<a id="automationchanged--emit"></a>

#### `automation/changed` — emit

A Host-wide automation task change.

```ts cordis-catalog
/**
 * A Host-wide automation task change.
 * @mode emit
 * @param catalog - the updated task catalog.
 */
'automation/changed'(catalog: { tasks: readonly unknown[] }): void
```

Source: [`packages/api/session-controller/src/types.ts`](../../packages/api/session-controller/src/types.ts)

<a id="automationchanged--emit"></a>

#### `automation/changed` — emit

A Host-wide automation task changed; listeners may refresh their catalog.

```ts cordis-catalog
/**
 * A Host-wide automation task changed; listeners may refresh their catalog.
 * @mode emit
 * @param catalog - the updated task catalog.
 */
'automation/changed'(catalog: AutomationCatalog): void
```

Source: [`packages/automation/automation/src/index.ts`](../../packages/automation/automation/src/index.ts)
<!-- END GENERATED cordis-surface -->

Automation tasks (`ctx.automation`) are Host-wide durable records with scheduled Agent execution and a management Remote. Each task has a title, an instruction prompt, a lifecycle status (`active`, `paused`, `ended`), a delivery target, a repeat rule, execution history, and optimistic-concurrency metadata.

## Types

- `AutomationTask` — one durable task record.
- `AutomationRun` — one execution's status, result or failure, and owned Session id.
- `AutomationCatalog` — the full task list projected to a settings UI.
- `AutomationCreateRequest` / `AutomationEditRequest` — create and status edits.
- `AutomationTaskStatus` — `active`, `paused`, or `ended`.

Tasks and execution history are stored under `$GNK_HOME/automation/tasks.json` with atomic writes. This service is separate from the session-local `schedule` domain, whose only durable state is its own versioned event stream; automation tasks are a Host resource and are visible across sessions.

## Status and scope

The standalone page offers tabs for Enabled/Paused/Ended/All, manual creation, pause/resume, run-now and delete. One Host-local scheduler checks due tasks every 30 seconds by default. The first run creates the task's Session; later runs resume it with the configured default model. Each run stores assistant text or failure in task history. Restart marks in-progress runs failed and does not replay their claimed scheduled occurrence. Daily and weekly timing follows the stored IANA time zone.

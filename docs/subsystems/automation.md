# Automation tasks

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationservice"></a>

### `ctx.automation` — `AutomationService`

The automation service: durable CRUD with optimistic concurrency.

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
 * Edit status with optimistic concurrency.
 * @param request - task id, expected revision and optional new status.
 * @returns the updated task.
 */
@Remote('edit') edit(request: AutomationEditRequest): AutomationTask

/**
 * Record a manual run now (delivery is a later increment).
 * @param request - task id.
 * @returns the updated task.
 */
@Remote('run') run(request: AutomationTaskRequest): AutomationTask

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

Automation tasks (`ctx.automation`) are Host-wide durable records with a
management Remote. Each task has a title, an instruction prompt, a lifecycle
status (`active`, `paused`, `ended`), a delivery target, a repeat rule, and
optimistic-concurrency metadata.

## Types

- `AutomationTask` — one durable task record.
- `AutomationCatalog` — the full task list projected to a settings UI.
- `AutomationCreateRequest` / `AutomationEditRequest` — create and status edits.
- `AutomationTaskStatus` — `active`, `paused`, or `ended`.

Tasks are stored under `$GNK_HOME/automation/tasks.json` with atomic writes.
This seam is separate from the session-local `schedule` domain, whose only
durable state is its own versioned event stream; automation tasks are a Host
resource and are visible across sessions.

## Status and scope

The settings page offers tabs for Enabled/Paused/Ended/All, manual creation,
pause/resume, run-now and delete. Automatic time-based delivery is a later
increment; the current build records schedules and exposes management verbs.

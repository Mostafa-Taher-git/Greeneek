---
description: "Nine tools that let the model create, message, and coordinate teammates, for compositions mounting the Team plugins."
kind: "package-reference"
---

# @greeneek/gnk-tool-agent-team


## Summary

`gnk-tool-agent-team` gives the model a team toolset on top of the team domain package: create named teammates or a confirmed fleet, give writable teammates isolated lanes, checkpoint and integrate their reviewed patches, steer messages, wait for progress, interrupt a stuck teammate, and manage a shared task board — thirteen tools in total. A short policy section in every member's prompt teaches the model when to form a team (only when you ask for one) and how to coordinate on isolated or shared workspaces. Mounting it replaces legacy subagent controls with the same tool names, so a composition that wants both must disable the legacy definitions. It is experimental: excluded from official releases, carries no stability promise, and creates teammates only when you explicitly ask for a team or fleet.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add this package on top of `@greeneek/gnk-agent-team` when the model should run a team through tools. Once mounted, every team member — the Lead and each teammate — gets the same thirteen tools plus a policy paragraph that states its own role and name. Teammates receive a lane guard that denies Git mutations and, in a read-only lane, file mutations.

### When to choose it

Choose it when the model should create and coordinate teammates by itself rather than a human driving subagent controls. Avoid it when the legacy global subagent tools with the same names must stay available: the team tools replace them for team members, so a composition that wants both must disable the legacy definitions. The fixed policy creates teammates only when you explicitly ask for a team or teammates, so ordinary tasks never trigger delegation on their own.

### Smallest working example

The smallest addition to an existing composition is the two-package fragment from the [agent-team README](../agent-team/README.md#smallest-working-setup): durable session storage, the team domain package, and this package. The plugin itself takes two optional settings:

```yaml
- id: tool-agent-team
  name: '@greeneek/gnk-tool-agent-team'
  config:
    freshProvider: spawn
    forkProvider: fork
```

| Field | Default | Meaning |
|---|---|---|
| `freshProvider` | `spawn` | Provider that starts fresh teammates |
| `forkProvider` | `fork` | Provider that starts fork teammates |

The generated [configuration catalog](../../../docs/config-catalog.md#greeneekgnk-tool-agent-team) is the exhaustive source for every accepted field and its JSDoc.

Try it by asking the Lead model: "create a teammate named reviewer to check the diff, then send reviewer the change summary". The model calls the creation tool and then the messaging tool.

### What the model can do

The thirteen tools group into six capabilities:

- **Create a teammate** — `spawn_teammate` takes a name, a description, and the initial task, with optional preset, model, reasoning effort, checkout, read-only flag, write scopes, and token ceiling; only the Lead can call it.
- **Create a fleet** — `spawn_fleet` validates every member, shows one approval card that echoes each member's provider, context, preset, model, effort, token budget, and write capability, then spawns only after an `allowed-once` decision. A rejection, cancellation, timeout, or missing approval capability creates zero children and zero worktrees.
- **Lanes** — `checkpoint_lane` stores the exact reviewed patch and hash; `integrate_lane` applies that patch to a clean primary checkout, runs gates, commits, and removes the lane; `discard_lane` checkpoints then removes a lane. Only the Lead can call them, and a failed merge halts the queue.
- **Send messages** — `send_message` steers a running member at its nearest step boundary, starts an idle member, and cold-resumes an inactive teammate.
- **See and wait** — `list_agents` shows the roster with live status; `wait_agent` waits for the next team change; `interrupt_agent` stops a teammate's current turn (Lead only).
- **Manage the task board** — `team_task_create`, `team_task_list`, `team_task_get`, and `team_task_update` add, browse, read, and update shared tasks.

Any member can message any other member and use the task board; only the Lead creates, integrates, discards, and interrupts teammates. Task updates keep the domain's owner and revision checks, so an outdated edit is rejected instead of overwriting newer work. The lane guard denies commit, merge, push, tag, and ref mutation through shell tools; it is a refusal, not a sandbox, and integration independently verifies the lane HEAD.

### What success and failure look like

Sending a message succeeds as soon as it is safely stored: the result is `accepted` (delivered now) or `queued` (waiting), and a queued message must not be resent. `wait_agent` returns `noProgress` right away when no other member is running or provisioning, telling the caller to wake a teammate first; otherwise it waits for the next change and the caller re-reads state afterward. Task edits based on an outdated revision are rejected rather than overwriting newer work.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the adapter and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The adapter is built on three commitments:

- **Scoped, not global.** Every registration lives on the member Agent's own `ctx`; nothing is installed for non-Team subagents or the host.
- **Declared results, compact JSON.** Every tool declares its complete result schema and renders that value as compact JSON, so the compiler checks `execute` against what the model is promised and no result spends tokens on indentation.
- **The domain owns authority.** Tools delegate to `ctx.agentTeams`, which enforces Lead authority and revision checks; the adapter adds no weaker path.

The [Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns the model-facing and scoping decisions.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, the fixed policy text, and the thirteen scoped tool registrations |
| [`src/lane-guard.ts`](src/lane-guard.ts) | Teammate Git-mutation guard and read-only file-tool denial |
| — | No runtime invariant companion is published; the Team service owns durable and authorization relations. |

### Policy and tools

One `team:policy` section on the member scope teaches each member its role and the coordination rules; the fixed text and the nine tool registrations are declared in [`src/index.ts`](src/index.ts). The nine tool schemas appear only in Team member scopes, so non-Team subagents keep the default catalog. Scoped registrations with the same names as the legacy global continuable-subagent controls shadow those globals for team members only.

### Scoped registration and teardown

`maybeInstall` runs for every live Agent and subscribes to `agent/created`; it skips Agents without Team membership. Disposal of an Agent runs the installed disposer, and plugin HMR disposes every installed scope before reinstall. Each disposer unwinds registrations in reverse order, so a failed install cannot leave a partial scope.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the domain service to the exact schemas and the decisions behind the design.

- [agent-team package](../agent-team/README.md) — the `ctx.agentTeams` domain service behind these tools.
- [Agent Teams subsystem](../../../docs/subsystems/agent-team.md) — durable Team types and service API.
- [Generated tool catalog](../../../docs/tool-catalog.md#greeneekgnk-tool-agent-team) — every tool schema the model receives.
- [Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) — model-facing, scoping, and isolation decisions.

-----

<a id="model-experience"></a>
## Model Experience

### Team policy and tools

#### What the model sees

One stable policy section states the exact Team role/name/id, the explicit-delegation requirement, isolated versus shared lanes, the teammate Git-mutation denial, reviewed Lead integration and queue halt, filesystem stale-version recovery, Bash/formatter/codegen risk, task and write-scope coordination, Steer delivery, the no-retry mailbox rule, and the Lead's duty to wait before answering. The thirteen Team schemas from `spawn_teammate` through `team_task_update`, including `spawn_fleet`, `checkpoint_lane`, `integrate_lane`, and `discard_lane`, appear only in Team member scopes.

#### Token effect

Fixed policy and schema cost on every Team member request. Tool calls add compact JSON roster, task, wait, or receipt results. Peer content is retained by the Team domain in the target's history.

#### KV Cache effect

Prefix-stable while the Team plugin generation, configuration, member role/name, and schemas remain unchanged. The per-member identity line differs across Agents. Tool results and peer messages append after the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe what the policy and tools cannot guarantee for a team. They are current package constraints, not a comparison with other collaboration surfaces.

- **Prompt policy is coordination, not confinement** — it cannot stop Bash or external processes from writing overlapping files.
- **No autonomous team creation** — ordinary tasks do not trigger delegation unless the user explicitly requests it.
- **No Web controls** — browser roster and task-board presentation is outside this runtime package.
- **Opt-in composition** — the package publishes with the gnk release family and mounts through [`gnk-agent-team-profile`](../../bundle/agent-team-profile/README.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

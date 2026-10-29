---
description: "Use the Web Agent Teams roster, shared task board, and teammate navigation panel."
kind: "package-reference"
---

# @greeneek/gnk-client-ui-agent-team


## Summary

This package adds an Agent Teams action to the Web conversation header, where a user can inspect the current roster, manage the shared task board, and navigate into a teammate's conversation. It also contributes a Fleet settings page that saves named fleets, shows each provider's honest availability, and launches a confirmed favorite. It reads authoritative Team state through the generated `ctx.remote.agentTeams` contribution, keeps ordinary child-history navigation on the stable addressed-subagent path, and stores favorites through the `fleet` settings namespace. Choose it for the experimental source-checkout Web profile; official releases exclude it. The browser projection does not extend the stable API Proxy, store Team state, or register model-facing input.

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

Install the package through [`@greeneek/gnk-agent-team-web-profile`](../../bundle/agent-team-web-profile/README.md) after the stable Web bundle and the Host-side Agent Teams profile. The Web Client loader mounts the `/client` export; the root Host export is inert, and the package has no user configuration fields.

### Inspect and navigate the roster

Opening the panel calls `agentTeams/view`. Roster rows show durable names, runtime status, model, and diagnostics. Selecting a healthy teammate refreshes the existing direct-child catalog and opens the ordinary `{ parentSessionId, childSessionId, mode: 'continuable' }` address. History and later human prompts continue through the stable addressed-subagent conversation path; this package adds no Team-specific address field.

### Manage the task board

The task board shows task identity, owner, blockers, readiness, advisory write scopes, and overlap warnings. A user can create, edit, assign or unassign, complete, reopen, and delete tasks through `agentTeams/createTask` and `agentTeams/updateTask`. Every update sends the displayed revision, and create or update rejections remain explicit business results.

### Save and launch fleets

The Fleet settings section lists every configured or registered provider with one honest state: ready, not installed, unsupported version, unauthenticated, or temporarily unavailable. Only a continuable in-process provider is ready; a provider that cannot hold a durable lane stays disabled, and the page never launches a probe run to guess. Favorites carry a name, an id, and members with provider, context, preset, model, reasoning effort, read-only flag, write scopes, and token ceiling.

Saving a favorite writes the `fleet` settings namespace through the shared settings scope; revision fencing and cross-field validation live on the Host. Launching requires a current session and an inline confirmation card that echoes every member's provider, preset, model, effort, budget, and write capability before any child or worktree exists. Cancelling the card launches nothing. A provider that became unavailable is refused rather than replaced by another provider.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export mounts the generated `ctx.remote.agentTeams` contribution from [`@greeneek/gnk-agent-team/remote`](../../subagent/agent-team/README.md), then registers its locale dictionaries and one conversation-header slot through Cordis effects. Disposing the plugin fiber removes both registrations.

Starting a create or update invalidates older refreshes. Success reloads the complete Team view so every task's derived fields stay current. A `team-task-conflict` result displays a stale-state notice only after that reload succeeds; a reload failure remains visible instead. Editing task text or scopes and changing dependencies use two sequential compare-and-set mutations because the Team service exposes them as separate actions.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Generated Remote, locale, navigation, and slot registrations |
| [`src/client/TeamAction.tsx`](src/client/TeamAction.tsx) | Roster and task-board interaction state |
| [`src/client/FleetSettingsSection.tsx`](src/client/FleetSettingsSection.tsx) | Fleet availability, favorite editor, and launch confirmation |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese, English, and Arabic panel copy |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams Web profile](../../bundle/agent-team-web-profile/README.md) — the opt-in bundle that mounts this Client plugin.
- [Agent Teams service](../../subagent/agent-team/README.md) — authoritative roster, task, and Remote behavior.
- [Conversation UI](../../client/ui-conversation/README.md) — the stable header slot and addressed-subagent navigation surface.
- [Experimental packages](../README.md) — incubation status and release exclusion.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser projection and task control surface registers no model-facing input.

#### KV Cache effect

No direct effect; the Team tools and ordinary conversation submission own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Snapshot refresh** — the panel refreshes on open, explicit refresh, and mutations; it has no live event subscription or mailbox timeline.
- **Ordinary child continuation** — a human message sent after navigation uses the stable addressed-subagent prompt path, not the Team peer mailbox.
- **No lifecycle or workspace controls** — the panel cannot spawn, rename, delete, or interrupt teammates, and write scopes remain advisory metadata.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. RPC is authoritative and the package owns only one disposable slot registration.

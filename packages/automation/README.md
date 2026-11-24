---
description: "The automation package group: durable Host-wide tasks with catalog and management Remotes."
kind: "package-group"
---

# automation/ — Host-wide scheduled work

## Summary

The `automation/` group holds the Host-wide automation task seam. Tasks are durable records with a title, instruction, status, delivery target, repeat rule, and optimistic-concurrency metadata. The service exposes list/create/edit/run/delete Remotes for settings UIs and emits `automation/changed` after each committed change. Session-local reminders belong to `gnk-schedule`, not this group.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`automation/`](automation/README.md) | Durable task records, file-backed store, and management Remotes | `ctx.automation` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Automation subsystem reference](../../docs/subsystems/automation.md) — the `ctx.automation` service API and the task-record types.
- [Automation tasks settings UI](../client/ui-settings-automation-tasks/README.md) — the browser surface over the management Remotes.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

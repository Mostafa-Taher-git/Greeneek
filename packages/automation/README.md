---
description: "The automation package group: Host-wide scheduled instructions with durable execution history."
kind: "package-group"
---

# automation/ — Host-wide scheduled work

## Summary

The `automation/` group holds Host-wide scheduled instructions. The service runs each instruction through an owned Agent, persists its result or failure in task history, and exposes list/create/edit/run/delete Remotes for settings UIs. Session-local reminders belong to `gnk-schedule`, not this group.

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

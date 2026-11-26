---
description: "Automation tasks settings section with status tabs, search, manual creation and task management"
kind: "package-reference"
---

# @greeneek/gnk-client-ui-settings-automation-tasks

## Summary

`gnk-client-ui-settings-automation-tasks` contributes the Automation tasks settings section. It renders Enabled/Paused/Ended/All tabs, search, a New split button with Create in a session and Create manually, per-tab empty states, a manual-create form, and task rows with pause/resume, run-now, delete, and expandable execution results. All data comes from the Host `automation` Remote; product copy is localized in zh/en/ar.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Automation tasks settings section

#### What the model sees

Nothing from this package enters a model request. The section reads and edits Host-owned task records through `ctx.remote.automation` and renders them for the user.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **Host-owned execution** — scheduled and manual instructions run through an owned Agent; this client reads the persisted result history from the Remote.
- **Session creation is a navigation** — Create in a session opens a new session; it does not prefill a model prompt that creates the task.

### Dev Note

No invariant companion is published. The package owns a standalone main-column page and a sidebar shortcut.

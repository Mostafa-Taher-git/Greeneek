---
description: "Host-wide automation tasks: durable task records with status, catalog and management Remotes"
kind: "package-reference"
---

# @greeneek/gnk-automation

## Summary

`gnk-automation` provides the Host-wide automation task seam. Tasks are durable records with a title, instruction prompt, lifecycle status, delivery target, repeat rule, and optimistic-concurrency metadata, stored under `$GNK_HOME/automation/tasks.json` with atomic writes. The service exposes list/create/edit/run/delete Remotes and emits `automation/changed` after each committed change. It is separate from session-local `gnk-schedule`, whose only durable authority is its own versioned event stream.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Host automation service

#### What the model sees

Nothing from this package enters a model request. The service stores task records and answers management Remotes such as `automation.list` and `automation.create` called by settings UIs.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **No automatic delivery** — the `run` Remote records a manual run time; timer, RRULE, and delivery execution are later work.
- **Local file store only** — tasks live in one JSON file under `$GNK_HOME`; there is no replicated or multi-node store.

### Dev Note

No invariant companion is published. The package owns one Host service with a management Remote.

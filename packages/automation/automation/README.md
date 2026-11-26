---
description: "Host-wide scheduled task execution with durable results and management Remotes"
kind: "package-reference"
---

# @greeneek/gnk-automation

## Summary

`gnk-automation` runs Host-wide instructions on a scheduler that scans every 30 seconds by default and stores tasks plus execution history under `$GNK_HOME/automation/tasks.json` with atomic writes. Each task creates one owned Session on its first run and resumes it for later runs; every execution creates and disposes its Agent handle, then stores the final assistant text or failure. The service exposes list/create/edit/run/delete Remotes and emits `automation/changed` after each committed change. It is separate from session-local `gnk-schedule`, whose only durable authority is its own versioned event stream.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Scheduled task execution

#### What the model sees

An active task dispatches its prompt as a logged user message through `ctx.agents.create()`; later runs resume the task Session through `ctx.agents.resume()`. The configured default provider and model drive each turn, and the completed assistant text or failure is stored in task history for settings clients.

#### Token effect

The task prompt and any model-driven tool use consume tokens for each execution.

#### KV Cache effect

Each execution follows the selected provider's cache behavior.

## Known Limitations and Deferred Work

- **Scheduler configuration** — `pollIntervalMs` sets the positive millisecond scan interval and defaults to 30,000.
- **Host-local scheduler** — one process owns the scheduler; multiple hosts sharing the same task file are not coordinated.
- **Restart recovery** — persisted `running` entries become failed with an interruption reason. Their scheduled occurrence remains claimed and is not replayed after restart.
- **Pause and delete** — pause prevents future scheduler dispatches; delete aborts an active execution and removes its task record.
- **Calendar timing** — hourly tasks follow elapsed one-hour intervals; daily and weekly tasks keep the anchor wall clock in the stored IANA time zone. A local time skipped by a daylight-saving transition is skipped.
- **Local file store only** — tasks live in one JSON file under `$GNK_HOME`; there is no replicated or multi-node store.

### Dev Note

No invariant companion is published. The package owns one Host service with a management Remote.

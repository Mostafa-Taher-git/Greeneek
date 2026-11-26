# Agent Note: Host automation owns scheduled Agent runs

Status: implemented

## Problem

Automation tasks stored instructions and timing metadata, but pressing Run only changed a timestamp and no Host process executed due tasks or kept their outcomes.

## Decision

`AutomationService` owns one Host-local scheduler and the task JSON store. It scans active tasks every configured polling interval, defaults to 30 seconds, and claims each due occurrence in the task history before dispatch. One-shot and hourly occurrences use their stored instant as the anchor; daily and weekly occurrences keep the anchor wall clock in the stored IANA time zone. A recurring occurrence skipped by a daylight-saving gap is skipped.

Each execution resolves the configured default model and creates an Agent through `ctx.agents.create()` for the task's first Session; later executions resume that Session through `ctx.agents.resume()`. The Agent scope installs the selected model, the prompt enters as a logged user message, and completion stores the final assistant text or error before the owned handle is disposed. Run now uses the same execution path. A task history entry left `running` at Host startup becomes a failed interruption; its scheduled occurrence remains claimed so restart does not replay it. Pause prevents future scheduled dispatch, resume re-enables it, and delete aborts an active Agent before removing the task record.

The store is shared by one Host process at a time. The file has no cross-process lock, and execution history grows with each run.

## Alternatives considered

**Use session-local `gnk-schedule`.** Rejected because automation tasks are Host resources visible across sessions; `gnk-schedule` persists reminder state in one Session log and sends reminders to that Agent.

**Update only `lastRunAt` and defer delivery.** Rejected because a successful Remote must represent actual instruction execution and retain its result or failure.

**Keep a task's Agent live between runs.** Rejected because each execution can use the currently configured model and the owned handle gives the run a bounded lifecycle.

## Testing

Package regression tests cover task CRUD, model-backed execution and result capture, provider failure, invalid input and time zones, scheduler dispatch, pause/resume, restart recovery, scheduled-occurrence deduplication, and deletion during an active run.

## Consequences

Automation results are available from the same durable task catalog without a second history store, and a process restart can distinguish incomplete work from undispatched work while preserving the task's Session context. The scheduler is single-process and polls rather than maintaining a cross-host lease; deployments must not have multiple Hosts writing the same file.

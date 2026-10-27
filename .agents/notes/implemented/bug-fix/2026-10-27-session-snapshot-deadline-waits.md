# Agent Note: Keep the missing-record diagnostic in snapshot deadline waits

Status: implemented

## Problem

The session-snapshot harness waits for durable records by polling the raw JSONL store. It used `vi.waitFor` for the subagent turn, goal phase, and inbox message waits. When a poll round (a recursive directory read plus a log read) outlives the whole wait window, Vitest reports its own `Timed out in waitFor!` text instead of the callback's assertion, so a failing scenario says only that something timed out. CI run 40254789718 lost the exact turn/end message that way.

`waitForPersistedTurnEnd` had already grown a bespoke `catch` that rethrows a pre-built budget error. The other schema waits did not, so the same load-dependent diagnostic loss remained in three helpers and would return with any new wait written the same way.

## Decision

`waitForPersistedRecord(check, message, timeoutMs)` is the single deadline loop for schema waits. It evaluates one completed `check()`, returns when it is true, throws the caller's `message` when the deadline has passed, and otherwise sleeps `WAIT_POLL_INTERVAL_MS`. A rejected `check()` propagates unchanged: a malformed persisted record is a scenario bug, not a not-yet state, and must not be retried into a timeout.

`waitForPersistedChildTurnEnd`, `waitForPersistedGoalPhase`, and `waitForPersistedInboxMessage` now call it. `waitForPersistedTitleAfterTurnEnd` and `waitForPersistedEventAfterTurnEnd` already did. `waitForPersistedTurnStart` keeps its own validation capture because it must distinguish a malformed turn record from a missing one, and `waitForPersistedTurnEnd` keeps its targeted budget-error `catch` for the same observable result.

## Testing

`packages/test-support/session-snapshot/tests/harness.spec.ts` gains a one-millisecond case for each migrated wait: the first harvest always loses to a 1 ms budget, so the rejection must still name the subagent turn, goal phase, or inbox message rather than Vitest's generic text. The existing 1 ms turn/end case remains.

The package suite passes 268 tests with one skipped, at 100% statements, branches, functions, and lines for every file under `packages/test-support/session-snapshot/src`.

## Alternatives considered

**Increase the wait timeouts.** Rejected: the defect is the lost message, not the budget. A longer window makes failures slower and still loses the message on a loaded runner.

**Retry `vi.waitFor` or add a `catch` to every helper.** Rejected: a retry repeats the same error-losing window, and a catch cannot tell a real budget expiry from a slow poll's generic timeout. One loop that owns the deadline and the message removes the ambiguity.

**Make `check()` throw the budget error and catch everything.** Rejected: that would also swallow malformed-record failures and turn a scenario bug into a timeout.

## Consequences

Each wait always performs one complete check, even with a 1 ms budget, so an observation that is already true succeeds instead of failing on the deadline. Between checks the loop sleeps the same interval `vi.waitFor` used, so polling cost is unchanged.

The helpers that still use `vi.waitFor` (`turnStart`, `turnEnd`, workspace files) keep their existing behavior; `turnEnd` already preserves its message, and `turnStart` has a distinct validation contract. A future schema wait should use `waitForPersistedRecord` rather than reintroducing the generic timeout path.

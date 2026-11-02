# Agent Note: Recorded session fixtures store zero for wall-clock fields

Status: implemented

## Problem

`GNK_SNAPSHOT=refresh` rewrote 14 `snapshots/web/*/session.jsonl` files while changing nothing the scenarios assert. Each diff moved the session header's `createdAt` to the new recording instant and re-drew the packed chunk rows' `data.dt` arrays (`[0,0,1,0,…]` → `[0,0,0,1,…]`), which are the wall-clock gaps between streamed chunks. A reviewer weighing whether to accept a golden refresh had to read those arrays line by line to discover they meant nothing — the same effort that let a recorded owner time zone (`clientTimeZone":"Asia/Shanghai"`) sit inside committed fixtures unnoticed until it was read directly.

The comparison never needed those values. `packages/test-support/session-snapshot/src/normalize.ts` zeroes `createdAt`, `time0`, `data.dt`, event `time`, `hook/result.durationMs`, and `goal/change` timestamps before comparing, and the seeder already rebuilds event instants from order when the header reads `createdAt: 0`. So the committed form and the compare form disagreed about which fields carry meaning: the recorder wrote noise the comparator threw away.

## Decision

**One definition of a volatile clock field, used by both ends.** `zeroRecordClocks(record)` takes the rule that was inline in `normalizeSessionLog` and `scrubSessionSnapshot` calls it on every record, header included. The recorder therefore writes `createdAt: 0` and all-zero `data.dt` instead of the recording instant, and the comparator's normalization of an already-canonical file is a no-op.

**The header keeps its shape, not its byte identity.** `scrubSessionSnapshot`'s contract said the session header passes through byte-identical; that is exactly what preserved the churn. It now re-serializes the header with the instant zeroed, which is what the seeder already anticipated.

**Idempotence is the acceptance condition.** Applying the scrub to its own output returns the same bytes, so a fixture refreshed twice cannot drift, and a refresh of an unchanged product produces an empty diff for these files.

## Alternatives considered

**Normalize at compare time only, as before.** Rejected: it keeps every refresh noisy and leaves the committed file asserting a value nothing checks.

**Strip the fields from the fixture format.** Rejected: `data.dt` and `time0` carry chunk ordering the packed-row decoder relies on, and the recorded log must stay loadable as a real session.

**Commit the churn each refresh and review it.** Rejected: it is the cost S0-11 exists to remove, and a diff of 14 timing-only files hides the two files that actually changed.

## Consequences

Existing committed fixtures still carry non-zero instants; the comparator tolerates them, so replay passes either way, and a refresh now rewrites each file to the canonical form once. Until that refresh lands, a golden refresh still shows those header lines — nothing else.

## Verification

`pnpm exec vitest run packages/test-support/session-snapshot` → 274 passed, 1 skipped, with 100% statements/branches/functions/lines on the package's `src`. `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/steering.e2e.ts` with `CI=true GNK_SNAPSHOT=refresh` now changes **one line** of `snapshots/web/steering/session.jsonl` (`createdAt` → `0`) and no `data.dt` array, where the same refresh previously moved many timing lines.

## Related

- [Testing policy](../../../../docs/testing.md)
- [Shipped patch layers refuse unresolved targets](../architecture/2026-11-02-shipped-patch-layers-resolve-or-refuse.md)

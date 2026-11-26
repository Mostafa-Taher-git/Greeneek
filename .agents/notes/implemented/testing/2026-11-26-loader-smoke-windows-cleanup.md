# Agent Note: loader-smoke temp cleanup on Windows

Status: implemented

## Problem

`runLoaderSmoke` removed its temporary profile directory once in a `finally` block. On Windows, a child that has just exited can still hold a file handle briefly, so the recursive removal intermittently failed with `EBUSY` and masked the assertion under test. `headless.expected.e2e.ts` reproduced this on this runner.

## Decision

`removeTempDir` retries `EBUSY`/`EPERM` for up to two seconds with a 100 ms backoff, then rethrows. Any other error still fails immediately; a persistent lock still fails the test. No assertion, timeout budget, or golden was changed.

## Alternatives considered

Deleting the failed directory silently would leave stale temp state; skipping cleanup on Windows would accumulate it. Retrying only the transient lock preserves the failure signal when a handle never clears.

## Testing

Windows: the previously failing `headless.expected.e2e.ts` case no longer reports EBUSY — it reaches the Linux-authoritative snapshot comparison, where Windows legitimately differs. Linux with the same patch: 1 file / 1 test passed, 11 skipped. `pnpm run typecheck` and oxlint on the file pass.

## Consequences

Windows loader smoke failures now report their real cause instead of a cleanup race; golden drift remains visible and untouched.

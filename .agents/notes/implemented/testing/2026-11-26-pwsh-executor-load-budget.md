# Agent Note: pwsh executor test budget under load

Status: implemented

## Problem

`packages/shell/pwsh-local/tests/executor.spec.ts` uses real pwsh spawns with 2-second sleeps. On a loaded runner those cases intermittently exceeded Vitest's 5-second default: with four workers the full suite showed 30 failures, then 4, then 1; the remaining failures moved between two tests in this file. Both passed when the file ran alone.

## Decision

The file now sets `vi.setConfig({ testTimeout: 15_000 })` with the measurement recorded in the comment. No assertion, command, or skip was changed; this raises only the process budget for real pwsh startup under load.

## Alternatives considered

Widening the global suite timeout would hide slowness everywhere. Skipping the file on Windows would remove real PowerShell coverage from the platform where it is native.

## Testing

`pnpm exec oxlint` on the file and `pnpm run typecheck` pass. A confirming full unit run with `--maxWorkers=4` after the change had 17765 passing tests and no failure in this file (the single remaining failure was an unrelated Inspector CDP poll timeout that passes when that file runs alone).

## Consequences

Real pwsh executor contracts remain verified under full-suite load without changing what they assert.

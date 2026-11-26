# Agent Note: PTC e2e on the deployment shell

Status: implemented

## Problem

`apps/cli/tests/profiles/headless/tests/ptc.e2e.ts` mounted `LocalBashExecutor` and `ToolBash` unconditionally and issued bash-only commands, so its keyless real-worker contracts failed on Windows where the deployment shell is pwsh. The failures were harness/platform mismatches, not PTC product defects.

## Decision

The harness now mounts `PwshLocalExecutor` plus `ToolPwsh` on Windows and the bash pair elsewhere. Tool identity, job id, background command syntax, and sleep command are derived from one platform constant. All PTC assertions — background job publication, `job_output`, abort ownership, `job_kill`, signal coupling, and `tool/code-dispatch` records — remain intact. The job-publication poll allows up to 5 s for slower Windows pwsh startup.

## Alternatives considered

Skipping the file on Windows would leave the PTC contract untested on that platform. Weakening the dispatch or cancellation assertions would hide exactly the regressions the file exists to catch.

## Testing

Windows: `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/headless/tests/ptc.e2e.ts` — 5 passed / 2 skipped. Linux with the same patch: 5 passed / 2 skipped. `pnpm run typecheck` and oxlint on the file pass.

## Consequences

The PTC lifecycle is now verified on both platforms without changing the Linux-authoritative goldens or product code.

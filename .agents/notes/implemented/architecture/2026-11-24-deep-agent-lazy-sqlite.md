# Agent Note: Deep-agent SQLite opens on first use

Status: implemented

## Problem

The shipped Web profile mounts the Deep-agent runtime at boot. The store imported `node:sqlite` eagerly and the Host plugin recovered Workers immediately, so startup emitted `ExperimentalWarning: SQLite` even when no Deep-agent feature was used.

## Decision

The store resolves `node:sqlite` through `createRequire` inside `openDatabase`, and the store opens its connection on the first repository operation instead of in the constructor. The Host plugin wraps the service so recovery and source polling start on the first async Consumer call; synchronous members and Remote registrations stay available at boot. The Node compatibility test keeps its warning assertion and only accepts Windows' `-1` SIGTERM code instead of POSIX `0`.

## Alternatives considered

Suppressing the warning in the test or via `NODE_NO_WARNINGS` would hide a real startup cost. Disabling Deep-agent in shipped profiles would remove an accepted feature.

## Testing

`GNK_REQUIRE_BUILT_CLI_SMOKE=1 vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` passes with no SQLite warning; Deep-agent's 72 unit tests and `pnpm run typecheck` pass.

## Consequences

Booting a Web host no longer loads SQLite. The first Deep-agent call pays schema initialization and recovery, and its prompt assembly happens after that point.

## Related

[2026-11-24-session-tiling.md](2026-11-24-session-tiling.md)

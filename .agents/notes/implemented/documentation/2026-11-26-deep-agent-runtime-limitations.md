# Agent Note: Deep-agent runtime README limitations

Status: implemented

## Problem

`packages/deep-agent/runtime/README.md` listed three limitations that no longer describe the shipped code: placeholder worker effect handlers, no source adapters, and boot-only policy. The runtime wires `AgentWorkerExecutor` for real `ctx.agents` sessions, mounts GitHub and Discord sources, and exposes `saveSettings` with revision checks that the panel calls. Feishu is out of scope.

## Decision

The Known Limitations section now records the actual deferred work: record management is read-only in the panel, Discord ingestion needs a bot token, and Feishu is not a supported integration. No product code changed. The generated config catalog was refreshed because an earlier source edit shifted a documented source line.

## Testing

`pnpm run doc-sync` 32 passed / 0 failed; `pnpm run typecheck` exit 0. Deep-agent package suites were verified separately: 9 files / 72 tests passed.

## Consequences

The README no longer contradicts the runtime's shipped capabilities; remaining gaps are stated as current limitations.

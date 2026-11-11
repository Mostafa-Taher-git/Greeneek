# Agent Note: Host/Client TypeScript face split closes TS2717 for the core chain

Status: implemented

## Problem

`pnpm run typecheck` was red with TS2717 (`Subsequent property declarations must have the same type`) on `Context.sessions`: the host `SessionStore` and the browser `ISessions` merged under the same key. Client programs reached the host declaration through host `.d.ts` chains, because host packages import `@greeneek/gnk-session` main (whose `src/index.ts` declares `sessions: SessionStore`) and the client program resolves Source via `paths`.

The conflicting augmentation lived in `packages/core/session/src/index.ts`. Every consumer leaf compiled by the client program that transitively touched host package mains pulled the host augmentation into the browser program.

## Decision

Split the compiler faces of the packages on the leak path into solution roots with `tsconfig.host.json` / `tsconfig.client.json` leaves, so client programs only ever see browser-safe leaves:
- `packages/core/session` (client: `types.ts`, `surface.ts`, `chunk-rows.ts`)
- `packages/core/agent` (client: `types.ts`)
- `packages/subagent/subagent` (client: `client.ts`, `control-types.ts`, `projection-types.ts`, `harness-types.ts`)
- `packages/subagent/agent-team` (client: `client.ts`, `types.ts`, `fleet-settings.ts`, `harness-descriptor.ts`, `error.ts`, `lane-policy.ts`, `validation.ts`)
- `packages/session/session-projection` (client: `types.ts` only)
- `packages/session/session-title` (client: `client.ts`, `types.ts`)

Every reference in the repository was rewritten to the relevant leaf (`.../core/session/tsconfig.host.json` vs `.../tsconfig.client.json`), chosen by which base the consumer extends. Root aggregates gained a disambiguation rule: `packages/client/ui-user-questions/tests/node-plugin.client.spec.ts` is excluded from `tsconfig.client.json` because it composes host runtime plugins under vitest only; `*.host.spec.ts` files already belong to the host aggregate.

Supporting moves:
- Harness capability interfaces moved to `packages/subagent/subagent/src/harness-types.ts` (no imports), re-exported from `types.ts` (unchanged public surface) and `client.ts`. `packages/subagent/agent-team/src/harness-descriptor.ts` now imports `HarnessCapabilities` from `@greeneek/gnk-subagent/client`, so the client leaf stops pulling the host provider graph in.
- Both projection-declaring leaves (`subagent/src/projection-types.ts`, `session-title/src/types.ts`) now import their augmentation target (`@greeneek/gnk-session-projection/types`).
- Type-only imports resolve to `/types` / projection subpaths from remaining leaf consumers (`jobs/types.ts`, `workspace` entity/spec/index).
- The `agent-team` client leaf locally overrides `"types": ["client-build-environment", "node"]` (the `base.client` comment sanctions local overrides) because `fleet-settings.ts` validation imports `node:util` through `error.ts` and schemastery.

Accepted tradeoff: `packages/core/agent/src/types.ts` retains a type import from `@greeneek/gnk-session/types`, which is leaf-safe; no diagnostic remains.

## Consequences

`pnpm run typecheck` (host build + `tsc -b tsconfig.client.json`) is green. `pnpm run build`, `pnpm run test:gui` (311 files / 4292 tests), `pnpm run test` (full run: 16801+ tests pass, remaining 8 failing files reproduce identically on a HEAD worktree), `pnpm run lint`, and `pnpm run doc-sync` (31/31) have been re-verified this change.

## Alternatives considered

- **Suppress TS2717 with `any` casts** — weakens the merged `Context` contract both sides rely on; rejected.
- **Drop the client/browser program** — the GUI needs compile-time safety across plugin boundaries.
- **Move `errorMessage`'s formatting to a browser-safe renderer and drop `node:util`** — changes `inspect`-pinned error text consumers assert on (`{ kind: 'user' }` rendering is asserted in `team.spec.ts`); rejected in favor of the local `types` override.

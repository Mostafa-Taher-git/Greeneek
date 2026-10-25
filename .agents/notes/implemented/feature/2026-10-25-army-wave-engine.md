# Agent Note: Army wave engine lands as ctx.waves for concurrent one-shot subagent fleets

Status: implemented

## Problem

Army mode (v0.3.4 plan workstream F) promised many concurrent one-shot subagent children under one shared concurrency cap, with per-member and per-wave token budgets that actually kill overage, and cancellable runs controlled from the browser — but the subagent seam only knew serial starts: no shared cap, no aggregate budgets, and a started child was invisible to cancellation once its request left. A fleet without those teeth turns Army mode into unbounded parallel cost, which eight to sixteen streaming children burn fast.

## Decision

The engine ships as `packages/subagent/wave` (`@greeneek/gnk-subagent-wave`), mounting `ctx.waves` (`WaveRuntime`) on the subagent capability seam with these rules:

- **Admission and concurrency.** One Lead agent admits a `WaveRequest` (label, member specs, completion and budget policy) and the engine launches every member under a config-validated `maxConcurrent` (default 8, ceiling 16) through the named providers the subagent registry resolves. The shared counting semaphore hands a released slot directly to the oldest still-live waiter, so queued members never race fresh acquire calls past the cap.
- **Budgets with teeth.** Cost meters at `agent/pre-step` per member and as a wave aggregate; crossing either token budget hard-kills the member (`budget-killed`) and the wave settles as `partial` with the kill diagnostic.
- **Engine-owned cancellation.** Each member's `AbortController` is minted at admission, so `cancelMember`/`cancelWave` reach a member whether it is queued, launching, or running, and the emergency stop (`cancelAllForParent`) cancels every unsettled wave of one Lead session. Wave teardown waits for aborted children and their provider disposal, so a cancel never leaves a zombie child.
- **Deterministic settlement.** Members settle in spec order with explicit statuses; `onComplete: 'continue-others'` is the default, and `fail-fast` aborts siblings only after a failed or budget-killed launched member — a user cancel never triggers it.
- **Capped results, not transcripts.** Per-member output text truncates at `maxResultBytes` UTF-8 bytes without splitting a code point, an over-cap structured value drops, and usage records per row; the Lead sees settled rows, never member transcripts.
- **Thin browser face.** Typert `@Remote` faces (`list`, `cancelMember`, `cancelWave`, `cancelAll`) expose live fleet views and control; unknown ids surface as typed `RemoteError` codes instead of host throws.

## Alternatives considered

**Spawn per call with no seat cap (fork per go).** Rejected: without a shared semaphore there is no single place that bounds a sixteen-member fleet, aggregate budgets become per-call guesses, and nothing reaches queued members — the plan named the concurrency seam explicitly for this reason.

**Cancellation owned by the UI layer.** Rejected: aborts must live on the host plane so a cancel reaches children the browser never sees; a viewer-side abort would leave queued members racing tab closes and lose the emergency-stop guarantee.

**Durable wave Session events now.** Deferred: the Lead-facing tool Consumer and fleet UI do not exist yet, so wave events would mint a persistence schema with no consumer; the engine stays process-local until that surface arrives, and the README records the limitation.

**A Lead tool and Army preset in the same wave.** Rejected: user-visible Army surfaces must ship with the fleet view (details-panel fleet tabs and the sub-1220px composer fallback) so composition can be tested end to end; mounting a tool without its UI would expose an unobservable surface.

## Consequences

- Nothing mounts `ctx.waves` yet: no preset, profile, or model-facing tool, so Army mode stays invisible to sessions until the Lead tool Consumer and fleet view land next; an idle context pays zero.
- Budget enforcement is honest only with a token usage projection mounted: with budgets configured but no meter, kills read zero (documented in the package README's Known Limitations).
- There is no durable wave record — a restart mid-wave cancels by teardown; the fleet Session events (plus the persistence catalog regen they require) belong to the Army UI wave.
- The subagent group table, tsconfig path aliases, host project reference, workspace lockfile, and the cordis catalog (service rendered on `docs/subsystems/subagent.md`, wave contract types classified to the package's own `src/types.ts`) all register the new package.

## Verification

- `pnpm exec vitest run packages/subagent/wave` — 40 tests pass: admission/config validation, semaphore hand-off and abort races, budget kills including abort-rejecting children, byte caps and truncation edges (multi-block output, astral planes, unserializable structured values), teardown with disposal failures and settle-after-dispose ordering, remote face error mapping, and disposed-parent pruning across closed and foreign waves.
- Scoped per-file coverage (`--coverage.include="packages/subagent/wave/src/**"`) reports 100% statements, branches, functions, and lines on both source files — the repo's CI gate demands per-file 100%.
- Gates pass: `verify-cordis-catalog` (regenerated byte-identical), `verify-tsconfig-paths`, `verify-package-readme-model-experience`, `verify-package-invariants`, `verify-package-readme-limitations`, `verify-md-wrap`, `verify-md-links`, `verify-doc-refs`, `verify-package-paths`, plus repo `typecheck` over the new host project reference.

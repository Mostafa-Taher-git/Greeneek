# Agent Note: Army Lead tool Consumer mounts wave_dispatch and wave_cancel over ctx.waves

Status: implemented

## Problem

The wave engine (`ctx.waves`) landed with no model-facing surface: a Lead agent could not dispatch a fleet, wait for its settled rows, or cancel what it had started, so the engine was invisible to sessions — the wave engine's own note named the gap as "nothing mounts `ctx.waves` yet … an idle context pays zero". The tool that closes this gap must also stay honest to the engine: a fleet tool that re-implemented caps, budgets, or cancellation would create a second enforcement layer that drifts from the engine's own config and semantics.

## Decision

The Consumer ships as `packages/subagent/tool-wave` (`@greeneek/gnk-tool-wave`), a plain Host plugin requiring `tools` + `waves` that mounts exactly two `defineTool` tools inside one named effect (`tool-wave.fleet`) whose disposables tear down in reverse, so the cancel button can never outlive its dispatcher:

- `wave_dispatch` maps validated call arguments onto one engine `WaveRequest`: `members` are closed objects (required standalone `prompt`; optional `role`, `provider`, `model`, `reasoning_effort`), the plugin config's `provider` is the default member provider and a member's own `provider` overrides it, `model`/`reasoning_effort` resolve through `ReasoningEffortId` into member `agentOptions`, and the tool owns what the registry schema cannot express — the 1..16 member bound and positive safe-integer `max_tokens_per_member`/`max_wave_tokens`, plus rejection of undeclared top-level keys, all collected into one `ToolArgsError` before the engine is touched.
- `wave_cancel` scopes every action through `ctx.waves.listWaves(parent.session.id)` before `cancelWave`: a wave id the calling session never retained renders the denial `Wave <id> is not retained for this session.`, a closed wave reports `already settled`, omitting `wave_id` is the parent-scoped emergency stop — so an engine throw for a foreign id can never reach the model.
- Rendering is pure (`src/render.ts`) over the engine's settled records: one report row per member in spec order (status, tokens, child session id, stop reason, model, truncation, diagnostic), per-member output flattened from the engine's byte-capped result, structured values sanitized through a lossless JSON round-trip, and cancel outcomes rendered one line per wave.
- Requests without a calling agent are rejected loud (`exec.agent` undefined), and both tools declare `isConcurrencySafe` because overlapping dispatches and cancels only append reports and flip engine-owned member states.

## Alternatives considered

**One tool with a `dispatch`/`cancel` action field.** Rejected: the two operations have different argument sets, different report values, and different failure semantics; two schemas keep the registry contract legible and let `wave_cancel` stay visible on its own after a dispatch has returned.

**Quoting member transcripts in the dispatch report.** Rejected: the engine already truncates member output at its configured byte cap and drops over-cap structured values, and the Lead is meant to see rows, not transcriptions; re-rendering transcripts in the tool would reintroduce exactly the cost the engine's cap exists to bound.

**Cancelling straight through `ctx.waves.cancelWave`.** Rejected: `cancelWave` throws for an unknown or foreign id, which would surface as an engine error instead of a model-legible denial; the retained-views scoping keeps wave ownership with the calling session and turns the closed-wave case into an idempotent `already settled` row.

**A `tool:<name>` system-prompt section teaching fleet usage.** Rejected for now: the tool descriptions already state member independence, budget behavior, and cancel caution, and no Army composition preset exists yet to anchor prompt wording to; adding a section is deferred until that surface lands.

## Consequences

- Army mode has a model-facing dispatch surface: an agent with these tools can fan out up to sixteen one-shot members per call under the engine's concurrency cap and token budgets, then cancel any or all of its retained waves.
- The wave engine's deferred "Lead-facing tool Consumer" gap is closed for dispatch and cancellation; the browser fleet view and the Army preset remain their own follow-up work.
- The generated tool, plugin, and configuration catalogs, the tsconfig path aliases and host project reference, the workspace lockfile, the subagent group table, and the subsystem page now register the package.
- Budget honesty still rides on the engine: with the `tokenUsage` projection unmounted, configured ceilings read zero and no kill fires — an engine limitation restated in the package README.

## Testing

- `pnpm exec vitest run packages/subagent/tool-wave` — 31 tests: plugin/effects and provider defaults, argument errors (undeclared keys, member bounds, budgets) surfaced through `isError`, no-agent rejections, four-member rendered reports, byte-bound truncation, budget kill through the metered pre-step veto, cancel by id and cancel-all across queued, running, and settled waves, foreign-id and closed-wave denials, and both tools' execution-mode classification.
- Scoped per-file coverage (`--coverage.include="packages/subagent/tool-wave/src/**"`) reports 100% statements, branches, functions, and lines across the three source files.
- `pnpm exec vitest run packages/subagent/wave` — 42 engine tests still green; the engine is untouched.

## Verification

- Catalog gates green after regeneration with bumped pins: tool catalog (both tools) and plugin catalog (`24 Tool` groups / `259 workspace packages`); tsconfig paths verify, package invariants, package paths, package dependencies, the MIT license check, md wrap, md links, subsystem pages, doc refs, agent-note format/classification, export JSDoc (no new findings), rebrand residue, repo typecheck, and repo lint (no new tool-wave findings) all pass.
- The regenerated module graph now carries `tool-wave → agent/llm/subagent-wave/tools`; `verify-module-graph` is fresh.
- Two repo-wide gates fail identically at HEAD on committed trees away from this package, so they are pre-existing: `constraints` (craft/desktop/landing manifest policies) and `verify-cordis-config` (test-fixture resolution), both untouched here.

# Agent Note: Ship Maestro as a durable-lane preset with fixed delegation lanes

Status: implemented


## Problem

Maestro was a disabled row with a promoted package family behind it: the Team domain, its tools, and the browser roster existed, but no composition mounted them and no preset told the model how to use them. `agentPreset` on the subagent start request had landed, yet nothing could reach it — the delegation tool exposes only `description` and `prompt` to the model, so a lane preset had no path from a prompt to a child.

Two shapes were available and they differ in what the model sees each turn. A model-facing `preset` parameter on the delegation tool would let a Lead name any roster preset per call, but it puts the whole roster into every delegation call's decision space and makes a lane's tool list a runtime choice rather than an authored one. A configuration field plus one tool per lane keeps each lane's model-visible surface fixed and lets the preset author decide which lanes exist.

## Decision

`tool-subagent` gained an optional `preset` config. It passes `agentPreset` on the one-shot start request, so the child composes that preset inside its creation window; an unknown id rejects the delegation before a child exists. Two configurations are refused at load instead of at the first delegation: `preset` with `backgroundMode: continuable`, because a continuable child restores composition from the version-pinned descriptor and would silently revert to its parent on resume, and an empty `preset` string.

`packages/preset/agent-presets/presets/maestro/` composes the mode: a Lead persona that names the lanes and the review duty, three delegation tools bound to `standard`, `instructor`, and `pixels-designer` with distinct tool names (`subagent_code`, `subagent_docs`, `subagent_design`), the Team tools for the durable board and mailbox, shell, filesystem, search, ask-user, todo, and web.

The Team service joined `packages/bundle/base` beside the wave engine — host plane, no model-facing rows — and `packages/client/ui-agent-team` joined `packages/bundle/web-app`. This is the Army split: the engine that holds durable state is shipped, and the tools that describe it to a model are mounted only by the preset that uses them, so a Standard session pays nothing for either mode. The roster, seat, display map, and Web mode-row expectations now treat Maestro as a shipped mode rather than a placeholder.

Lanes are one-shot children. Team members are continuable, and their cold resume cannot carry a lane until the descriptor version changes, so the persona directs lanes at the delegation tools and the board at the Team tools rather than pretending a team member can hold a preset.

## Alternatives considered

**A model-facing `preset` parameter on the delegation tool.** Rejected for this step: it makes every delegation call carry roster-shaped choices, and a lane's tool list becomes something the model can vary per turn. The shipped lanes are product surfaces, not per-call tuning.

**Mount the Team tools in `base` so every mode has them.** Rejected: their names overlap the global continuable-child controls, and the tools cost schema in every turn. Preset-scoped mounting keeps Standard's request unchanged.

**Wait for descriptor version 4 and ship Maestro with continuable lanes.** Rejected: it would hold the whole mode behind a re-record pass that needs a provider key. One-shot lanes plus a durable board is a usable mode now, and the upgrade is additive.

## Consequences

- Maestro is selectable. Its preset mounts four rows that did not exist in any composition before, and `verify-runtime-closure` reports 7 presets and 135 packages closed, which is what forced the Python runtime manifest to declare the Team domain, its tools, and the browser plugin.
- A lane's children run the preset itself, not a restriction of the Lead's: `subagent_docs` reaches the model with the instructor's tools even when the Lead runs standard.
- The persona makes the Lead responsible for review and serial merging, but nothing enforces worktree isolation yet: lanes still share one checkout, which the package README already lists as a known limitation.
- `preset` is configuration-only, so a deployment that adds a lane must author a tool row. That is deliberate, and it is also the extension point Maestro G2's Fleet Settings would write.

## Testing

`packages/preset/agent-presets/tests/shipped-root.spec.ts` asserts the built-in roster now includes `maestro` and that it is healthy and system-trusted; `packages/client/ui-agent-preset/tests/components.client.spec.tsx` asserts the shipped position, the enabled pill, one glyph per row, and the hover preview for the new mode; `apps/web/tests/agent-preset-selection.e2e.ts` expects the row order with Maestro third and not disabled. `verify-cordis-config` resolves every plugin the preset names, and `verify-runtime-closure` proves the shipped runtime closes over the new rows.

Evidence: `pnpm exec vitest run packages/preset/agent-presets packages/client/ui-agent-preset` → 329 tests pass; `pnpm run typecheck` clean; `pnpm run verify-runtime-closure` → 7 presets, 135 packages.

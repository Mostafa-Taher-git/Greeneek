---
description: "Model-facing Army Lead tools for users and maintainers configuring, composing, or debugging concurrent one-shot subagent fleets over a wave engine."
kind: "package-reference"
---

# @greeneek/gnk-tool-wave

## Summary

`gnk-tool-wave` is the model-facing Army Lead tool: it mounts two tools over the wave engine (`ctx.waves`) so the calling agent can dispatch a labeled fleet of one-shot subagents — each member its own standalone prompt with an optional role, provider, model, and reasoning effort — under the engine's shared concurrency cap and token budgets, wait for the whole wave to settle, and cancel what it has running. `wave_dispatch` blocks until every member settles and returns one capped report row per member; `wave_cancel` cancels one retained wave by id or emergency-stops every unsettled fleet of the calling session, reporting already settled waves instead of touching them. One instance binds one configured default member provider and mounts both tools inside a single effect, so a partial teardown can never leave the cancel button registered without its dispatcher.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as the Lead-side Consumer of a wave engine: `ctx.waves`, the subagent seam, and at least one subagent provider must exist before the tools mount, and the token meter's `tokenUsage` projection is what makes budget enforcement real. The configured `provider` is only a default — a member's own `provider` field inside a call's `members` overrides it per call.

### Minimal configuration

Load the delegation seam, a provider, the token meter, the wave engine, and this tool; then name the default member provider. This composition dispatches members without their own `provider` field to the `spawn` backend:

```yaml
- name: '@greeneek/gnk-subagent'
- name: '@greeneek/gnk-subagent-spawn-in-process'
- name: '@greeneek/gnk-token-meter'
- name: '@greeneek/gnk-subagent-wave'
- name: '@greeneek/gnk-tool-wave'
  config:
    provider: spawn
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Registry name of the `ctx.subagents` provider launched for every member without its own `provider` |

The generated [configuration catalog](../../../docs/config-catalog.md#greeneekgnk-tool-wave) is the exhaustive source for every accepted field and its JSDoc.

### What the model's calls mean

Every member of a dispatch is a one-shot subagent that does not see this conversation: the required `prompt` must be complete and standalone, and the optional `role`, `provider`, `model`, and `reasoning_effort` shape that member's engine request. The engine's configuration owns a fleet's launch concurrency and per-member output byte cap, so those remain deployment choices rather than call arguments.

`wave_dispatch` blocks until every member settles and returns `{ wave_id, outcome, rows }`, with `outcome` one of `completed`, `partial`, or `cancelled`; a failed or budget-killed member still settles as its own row, and `on_complete: 'fail-fast'` cancels the surviving active members after the first failed or budget-killed launched one.

`wave_cancel` cancels a wave the calling conversation started: pass `wave_id` to cancel exactly one retained wave, or omit it to emergency-stop every unsettled wave of this conversation. A wave id the session never retained renders a denial, and a settled wave reports `already settled` — never re-cancelled — so raising the call after a dispatch has returned is always safe.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the tools bridge model arguments and the wave engine; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

One plugin instance is one default member provider plus both tools, mounted inside a single named effect: the two registration disposables tear down in reverse, so a partial teardown can never leave `wave_cancel` registered without its dispatcher. The tools close over `ctx.waves` and own no engine state — admission, launch concurrency, budgets, signals, settlement, and the wave records all live in the wave engine.

### Argument contracts

The registry's parameter root stays open, so undeclared top-level keys cannot be rejected by the schema alone: each tool checks its own accepted keys and reports every violation in one `ToolArgsError` before the engine is touched. Member objects are closed (`additionalProperties: false`), so a missing member `prompt` already surfaces as a registry argument error without tool work. `parseDispatchArguments` then collects the checks the DSL cannot express — a member count between one and sixteen, and positive safe-integer budgets — into that one errored result, so the model can fix the whole call at once.

### Report settlement

A dispatch rejects non-agent callers (`exec.agent` is the wave parent), then awaits one `ctx.waves.startWave` and renders the settled result: per-member rows in spec order, byte-capped output flattened to text, structured values sanitized through a lossless JSON round-trip, and the wave outcome kept beside the rows. `wave_cancel` validates arguments, scopes its action through `ctx.waves.listWaves(parent.session.id)` — cancelling only waves the calling session still retains — and reports one row per addressed wave.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin composition, tool registration, and the two execute paths |
| [`src/arguments.ts`](src/arguments.ts) | Parameter schemas, engine request mapping, and tool-owned bounds |
| [`src/render.ts`](src/render.ts) | Output schemas, canonical report values, and model-facing text |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from this tool's surface to the engine beneath it and the delegation seam it dispatches over.

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — the delegation seam this fleet rides on and the provider contract behind each member.
- [gnk-subagent-wave](../wave/README.md) — the wave engine's own contract: concurrency cap, budgets, engine-owned cancellation, and result caps.
- [Generated tool catalog](../../../docs/tool-catalog.md#greeneekgnk-tool-wave) — both tools' default schemas.
- [Generated configuration catalog](../../../docs/config-catalog.md#greeneekgnk-tool-wave) — every accepted config field.
- [Army wave engine Agent Note](../../../.agents/notes/implemented/feature/2026-10-25-army-wave-engine.md) — the engine's design record.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [`wave_dispatch` and `wave_cancel` schemas](../../../docs/tool-catalog.md#greeneekgnk-tool-wave) exist while the plugin is loaded. `wave_dispatch` takes a required `label`, a required `members` array whose closed member objects carry a required standalone `prompt` plus optional `role`, `provider`, `model`, and `reasoning_effort`, the optional `on_complete` sibling policy (`continue-others` default, `fail-fast`), and optional `max_tokens_per_member`/`max_wave_tokens` integer ceilings; `wave_cancel` takes only an optional `wave_id`. Undeclared top-level arguments are rejected as an errored result before the engine is touched, and dispatch bounds its own fleet — at least one, at most sixteen members, positive safe-integer budgets.

#### Token effect

Two fixed schemas per Lead request while the plugin is loaded. Each settled dispatch appends one bounded report (rows plus engine-owned diagnostics), and each `wave_cancel` appends its short report; per-member output text stays under the engine's configured byte cap, so a wave's visible payload is row-sized, never a member transcript.

#### KV Cache effect

Prefix-stable while the plugin is loaded and its tool definitions are unchanged; each settled report appends after the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this tool does not own and what it defers to the engine; they are current package constraints.

- **No wave state beyond one conversation's retained views** — waves stay process-local (the engine's deferred work), so a restart mid-wave cancels members by teardown and the model sees wave state only through these two tools' reports; there is no list surface of its own here.
- **Result caps and launch concurrency are deployment config** — `maxResultBytes` and `maxConcurrent` belong to the wave engine's configuration; this package cannot tighten one call's member output or raise a fleet's concurrency beyond the engine's settings, and its own sixteen-member ceiling is a tool constant.
- **No exec-signal forwarding and no member chaining** — the tool neither forwards the parent's `exec.signal` to members (engine-owned cancellation and budgets are the only kill surfaces) nor lets one member consume another's output, because every member prompt must be self-contained.
- **Member provider names are call arguments without discovery** — a member's `provider` must name a provider registered on `ctx.subagents` at dispatch time (the engine validates it), and this package registers no provider or model listing tool of its own.

<details>
<summary>Runtime invariant omission</summary>

**Runtime invariant:** No companion is published because the tools assemble plain requests and reports over the wave engine's own enforcement (member order, result caps, cancellation) — no owned relationship spans two services here, so independent observations cannot diverge.

</details>

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

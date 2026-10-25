# Agent Note: PTC capability-delta map toward a lazy Standard path

Status: proposed


## Problem

v0.3.4 M1 carries two distinct decisions about PTC, and only the first is shipped. [PTC pill removed from the new-session row](../../implemented/simplification/2026-10-24-ptc-pill-removal.md) shipped as `MODE_ORDER` plus a `HIDDEN_FROM_ROW` set in `packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx:69,88`, and the release ledger records the remaining half verbatim: "the accepted decision also requires migrating PTC capability into Standard through a lazy token-measured path — NOT STARTED" (`docs/plan-v0.3.4.md:25-31` scope, `.agents/notes/proposed/process/2026-10-25-v0.3.4-to-v0.3.6-release-ledger.md:46`).

The owner's constraints are negative as well as positive: not `mode: 'both'` as a global default, and not duplicating every tool schema on every turn. Both negatives are un-measured assertions in the plan (it quotes "3–6k tokens/step prompt inflation" with no artifact), and the plan's own stated first step — "First write a capability-delta map (PTC-only behavior vs Standard equivalents, runtime services, prompt/SDK pieces, replay dependencies)" — has never been written. Without it, any implementation chooses between `both`, preset deletion, and a new lazy mechanism on assertion rather than evidence, and cannot tell which PTC capabilities Standard actually has.

This note is that map. It is read-only: it states what PTC is today, which Standard surface provides the equivalent, what each path costs in model-visible bytes measured from committed replay artifacts, and what breaks if the preset disappears. It records the migration options for a stale `agent-presets.default: ptc` and names the lazy mechanism the following implementation should use. No PTC behavior changes here.

## Proposal

Ship the delta below as the prerequisite, then implement the lazy path described in "Recommended mechanism". The map is one row per capability, with the composition row, the prompt or SDK piece, the replay dependency, and whether the Standard equivalent is always present or lazy.

### Capability delta

| Capability | PTC-only behavior today | Standard-mode equivalent | Composition and runtime rows | Prompt or SDK piece | Replay and snapshot dependency if the preset vanished | Equivalent lazy or always |
|---|---|---|---|---|---|---|
| `run_code` transport | One tool taking `{ code, description }`; the model writes a program against the registry and only its printed or returned value re-enters context (`packages/core/tools/src/ptc.ts:20,43-52`) | **None.** No Standard row, tool, or prompt section provides program-over-tools composition | Reserved transport outside the filterable layers, built by `ToolRuntime.requireCodeTransport()` (`packages/core/tools/src/index.ts:914-925`); inserted only when `modeFor(scope) !== 'native'` (`packages/core/tools/src/index.ts:1180-1182`); needs host-plane `ctx.codeRuntime` (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml:268-272`, `packages/bundle/web-app/cordis.patch.yml:49-50`) | The `run_code` schema itself (942 bytes measured) | `snapshots/session/ptc-turn`, `ptc-read-image`, `ptc-read-image-attachment-path`, `ptc-workspace-context`, `ptc-python-turn`, `both-mode-turn`; `apps/web/tests/shipped-composition.e2e.ts:191-206` | Nothing. A lazy path must introduce it, not restore it |
| Generated tool SDK prompt section | `tools:sdk` renders `declare const tools` plus fixed usage rules for every visible non-`run_code` tool (`packages/core/tools/src/ts-types.ts:249-317`) | **None.** Only a non-native `presentAs` or `mode` registers it (`packages/core/tools/src/index.ts:959-962`, `:867-884`) | Registered by the same `presentAs` effect as the mode; order `TOOLS_SDK: 5000` (`packages/core/system-prompt/src/index.ts:149`) | 32,190 bytes for a 26-binding catalog, measured byte-identical in `snapshots/session/ptc-turn/system-prompt.expected.md` and `snapshots/session/both-mode-turn/system-prompt.expected.md` | Every PTC prompt sidecar above; `snapshots/web/ptc-round/system-prompt.expected.md` | Nothing |
| Executor collapse | Under `ptc` only, a model-direct call naming anything but `run_code` resolves to `UNKNOWN_TOOL` before the policy pipeline (`packages/core/tools/src/index.ts:1315-1317`; [note](../../implemented/bug-fix/2026-08-07-ptc-executor-collapse.md)) | **Nothing to be equivalent to** — Standard advertises and executes the same set, so it needs no collapse | `collapses()` predicate, keyed by `modeFor`, not `defaultMode` (`packages/core/tools/src/index.ts:1306-1317`) | `tools:ptc-only` section, 159 bytes, order `PTC_ONLY: 800` (`packages/core/tools/src/index.ts:51,847-855`, `packages/core/system-prompt/src/index.ts:128`); renders empty under `both` | `ptc-*` sidecar prompts carry the line; `both-mode-turn` deliberately does not | Nothing; a lazy `both` path never needs it, a lazy `ptc` path needs it plus its prompt statement |
| Nested sub-call durability | `tool/code-dispatch-start` and `tool/code-dispatch` log each program sub-call, outside model history but read by persistence and UI | **None.** They are emitted only by the `run_code` bridge | `packages/core/tools/src/types.ts:40,56`; waterfall `tools/ptc-dispatch-log` (`packages/core/tools/src/index.ts:181,1287-1297`) | none | `snapshots/web/ptc-round/ui.expected.md` plus `apps/web/tests/ptc-round.e2e.ts`; `packages/client/ui-tool`, `ui-chat`, `ui-trajectory` sub-call rows | Nothing |
| `workflow` tool omitted | PTC disables the model-authored subagent-fan-out script tool and keeps its engine for `ralph` (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml:233-237`) | Standard **has** it (`packages/preset/agent-presets/presets/standard/agent.cordis.yml:226-227`); it is a different surface — subagent fan-out, not tool composition (`packages/workflow/tool-workflow/src/index.ts:1-10`) | Same row id, opposite `disabled`; `workflow-worker-thread` stays enabled in both | the `workflow` schema, and its SDK binding is deliberately absent under PTC | `apps/web/tests/shipped-composition.e2e.ts:198-205` asserts the SDK lacks `workflow: {` and keeps `ralph: {`; `packages/preset/agent-presets/tests/shipped-root.spec.ts:158-167` pins the disable | Standard's is always present; PTC's absence is a composition choice, not a missing capability |
| Everything else in the PTC catalog | 24 of the 26 visible tools, both shell gates, plan mode, compaction, delegation, jobs, skills, goals, web, todo, ask-user | **Identical rows, identical config.** `diff` of the two `agent.cordis.yml` files returns only the header prose, the `tool-workflow` `disabled`, and the `tool-presentation` row | `packages/preset/agent-presets/presets/{standard,ptc}/agent.cordis.yml:27-262` are row-for-row equal | per-tool guidance sections stay in the prompt under PTC as well, because they describe capabilities reachable through the SDK ([note](../../implemented/bug-fix/2026-08-07-ptc-executor-collapse.md)) | `packages/preset/agent-presets/tests/shipped-root.spec.ts:145-156` iterates both ids for `tool-web.fetch` | Always present in both |
| Preset display copy and Settings reachability | `ptc` stays in the roster and in `BUILT_IN_PRESET_KEYS` (`packages/preset/agent-presets/src/display.ts:46`), listed by the Settings management section | Standard is the same mechanism under its own id | roster discovery `packages/preset/agent-presets/src/discovery.ts`, shipped root prepend `packages/preset/agent-presets/src/index.ts:186-190` | none | `packages/preset/agent-presets/tests/shipped-root.spec.ts:85-115` asserts the six shipped ids including `ptc`, and that `default: 'ptc'` still resolves | Always present; only the hero row hides it (`AgentPresetSeat.tsx:88`) |

### Where the tool list and the schemas enter the request

The composition chain, not the loop, decides the catalog. `ToolRuntime` registers one provider at construction — `ctx.systemPrompt.tools(context => this.wireSchemas(context.scope))` (`packages/core/tools/src/index.ts:825`) — and `wireSchemas` is the single per-mode projection (`packages/core/tools/src/index.ts:972-993`): `native` maps every visible tool, `ptc` filters the result to `run_code` and sets `knownNames` to that one name, `both` returns every visible tool plus `run_code`. `view(scope)` resolves visibility and appends the reserved transport last (`packages/core/tools/src/index.ts:1143-1184`). The assembled `tools` array is then frozen into the logged request header at `packages/core/agent-loop/src/agent.ts:498-519` and copied onto the request at `packages/core/agent-loop/src/agent.ts:539`.

Mode resolution is per scope and nearest-wins: `modeFor` walks `chainLayers(scope)` from the last layer backwards (`packages/core/tools/src/index.ts:892-903`), and `chainLayers` puts the exact scope last (`packages/core/scope/src/store.ts:192-199`). So a declaration made on `agent.ctx` shadows the same declaration made by a preset's standing scope, and `presentAs` is scoped-only and throws without an agent scope (`packages/core/tools/src/index.ts:938-942`).

### Token cost, measured from committed replay artifacts

Every figure below is byte arithmetic on committed snapshot sidecars from one headless composition (`snapshots/session/{agent-instructions,ptc-turn,both-mode-turn}`), not an estimate. Token counts are **NOT MEASURED — requires GREENEEK_API_KEY** or a pinned tokenizer; bytes are the honest unit here.

| Presentation | System prompt bytes | Wire tool schemas bytes | Total model-visible catalog bytes | Delta vs `native` |
|---|---|---|---|---|
| `native` (Standard today) | 4,593 | 27,652 (26 schemas) | 32,245 | — |
| `ptc` | 36,944 | 942 (1 schema) | 37,886 | **+5,641 (+17.5%)** |
| `both` | 36,783 | 28,595 (27 schemas) | 65,378 | **+33,133 (+102.8%)** |

The three readings that fix the table: the `tools:sdk` tail is byte-identical between `ptc-turn` and `both-mode-turn` at 32,190 bytes and declares 26 bindings; the prefixes differ by exactly 161 bytes, the `tools:ptc-only` line, which `both` renders empty (`packages/core/tools/src/index.ts:844,853`); and `agent-instructions/tool-schemas.expected.json` is the same 26 schemas at 27,652 bytes that `both-mode-turn` carries minus `run_code`.

Two consequences the implementation must not lose:

1. `both` is the only option that carries every tool contract twice — as a JSON schema and as a TypeScript binding in the same request — so it is precisely the duplication the owner ruled out, at +33,133 bytes per step in the measured composition.
2. `ptc` is **not** a catalog saving: it costs 5,641 bytes more than `native` per step here, because the generated SDK rivals the schemas it replaces. PTC's economy is round trips and intermediate results — one step instead of five, and only the curated program output re-enters context (`packages/core/tools/src/ptc.ts:1-7`, [foundation note](../../implemented/feature/2026-06-15-ptc.md)). A lazy path that adds the SDK unconditionally would pay that cost on every turn of every Standard session.

The shipped Web Standard catalog is 26 names (`apps/web/tests/shipped-composition.e2e.ts:36-71`), so a lazily generated SDK for Standard would declare the same 26 bindings; its exact byte size is **NOT MEASURED** for the shipped preset — no committed sidecar pins the Web Standard prompt.

### A stale `agent-presets.default: ptc` today

VERIFIED by reading the resolution code. The value is read through `defaultId`, which prefers the settings document over the composition row (`packages/preset/agent-presets/src/index.ts:252-254`), from the `agent-presets` namespace registered at `packages/preset/agent-presets/src/index.ts:55,196-201`; the client writes it at `packages/client/ui-agent-preset/src/client/settings-store.ts:34`.

`resolve()` distinguishes an unnamed request from an explicit one (`packages/preset/agent-presets/src/index.ts:365-390`). Today a stale `default: ptc` is **not** sanitized and startup does not throw, because `ptc` is still on the roster, so the lookup succeeds and the session composes PTC. The `standard` substitution plus warning (`packages/preset/agent-presets/src/index.ts:372-381`, `FALLBACK_PRESET_ID` at `:63`) fires only when the named id is absent from the roster — which is the shipped behavior recorded in [PTC pill removed](../../implemented/simplification/2026-10-24-ptc-pill-removal.md) — and it re-raises `agent-preset/not-found` if no `standard` exists either (`packages/preset/agent-presets/src/index.ts:383-387`).

The asymmetry that decides the migration: a **new** session with a stale default survives the preset's deletion via that fallback, but an **existing** PTC session does not. Resume passes the session's recorded preset id explicitly (`packages/api/session-controller/src/agent.ts:442` and `:477-479`), and an explicit id is never substituted (`packages/preset/agent-presets/src/index.ts:356-358`). Cold-transcript readers take the same explicit path through `standingKeyFor` → `resolveMountable` → `resolve` (`packages/api/session-controller/src/skill-catalog.ts:94-101`, `packages/preset/agent-presets/src/index.ts:398-412`). Deleting `presets/ptc/` therefore throws `agent-preset/not-found` on open for every session recorded under it, and rejects `apps/web/tests/ptc-round.e2e.ts:33`, which resolves the shipped preset by `default: 'ptc'` with `roots: []`.

Migration options, with the property each one buys:

| Option | New session on a stale default | Existing PTC sessions | Opens the preset for explicit selection | Evidence |
|---|---|---|---|---|
| Keep the preset hidden (status quo) | composes PTC, no warning | open and replay unchanged | yes | `packages/preset/agent-presets/tests/shipped-root.spec.ts:106-115` |
| Keep the directory, reject `default: ptc` in `resolve()` with a sanitize-to-Standard note | Standard, one warning | open and replay unchanged | selectable only through Settings, as today | needs a new named-default deny list; none exists today |
| Rename the directory and publish a rename map | Standard or the new id | break unless the map is consulted on the explicit path too | only through the map | `packages/preset/agent-presets/src/index.ts:365-390` has no alias today |
| Delete the directory | Standard with a warning | **throw `agent-preset/not-found` on open** | no | `packages/api/session-controller/src/agent.ts:442,477-479` |

The pre-release stance permits a hard break, but this one converts a picker change into an unopenable history, which is a user-visible loss the decision did not ask for. UNVERIFIED (hypothesis, not read from code): whether any PTC sessions exist in real `GNK_HOME` stores outside this repository; nothing in-repo can answer it.

### Recommended mechanism

Reach for `ctx.tools.presentAs('both')` on the **agent's own** scope, invoked once from a logged per-session toggle, and nothing broader.

The extension point already exists and is complete: `presentAs` takes the mode, requires a scoped context, installs a layer cell plus the `tools:ptc-only` and `tools:sdk` sections through `ctx.effect`, and returns the exact disposer (`packages/core/tools/src/index.ts:938-966`); `gnk-agent-tool-presentation` is the shipped caller shape (`packages/core/agent-tool-presentation/src/index.ts:59-72`), which is also where the non-native modes wait for `ctx.codeRuntime` so a deployment without a runtime fails at mount and not at the first prompt. Nearest-scope resolution means an agent-level call shadows the Standard preset's standing declaration without touching other sessions (`packages/core/tools/src/index.ts:892-903`).

That is the whole mount. What the implementation still owns:

- **The trigger must be a logged session event.** Model-visible requires reconstructable (`docs/architecture.md:106`), and `agent-preset/selected` is the existing precedent for a mode fact recorded on commit (`packages/preset/agent-presets/src/index.ts:760`). A new `SessionEventMap` member with `@mode` and payload `@param` docs is the documented route, not an in-memory flag (`AGENTS.md` typed-events rule).
- **`both` is the correct lazy shape, `ptc` is not.** Under `both` native calls still execute and the collapse renders empty (`packages/core/tools/src/index.ts:844,1315-1317`), so a session that opts into code keeps its normal tools and gains the transport; under `ptc` a mid-session switch would deny every tool the session had used for its whole history.
- **Pay the header change once.** The catalog is part of the frozen request header, so activation appends `request/header` with reason `change` and starts a new request series (`packages/core/agent-loop/src/agent.ts:498-518`), which is the prefix-cache cost to measure before and after. Keeping the SDK text byte-stable is what makes it once-only: `renderToolsSdk` sorts lexicographically for byte-identical output across assemblies (`packages/core/tools/src/ts-types.ts:285-298`).
- **`codeRuntime` must reach every profile that can opt in.** It is composed only by `gnk-web-app` and `gnk-headless` (`packages/bundle/web-app/cordis.patch.yml:49-50`, `packages/bundle/headless/cordis.patch.yml:19-20`); a Standard session under `sdk`, `sdk-minimal`, or `acp` would hit the loud failure in `requireCodeRuntime` (`packages/core/tools/src/index.ts:1010-1020`).
- **Defer the narrower projection.** `both` is the only shipped lazy shape that adds `run_code` without removing anything, because `run_code` cannot be registered as an ordinary tool (`packages/core/tools/src/index.ts:1045-1047`, `:1077`) and `view()` inserts it only for a non-native mode (`:1180-1182`). A "native schemas plus `run_code`, no SDK section" variant needs a registry change, and the foundation note already defers per-tool visibility tiers pending evidence from `both` usage ([Per-tool visibility tiers](../../implemented/feature/2026-06-15-ptc.md)).

### What survives the preset disappearing

| Surface | Uses the `ptc` preset directory | Uses `tools.mode` / `presentAs` on a host row |
|---|---|---|
| `scripts/demo-ptc.mjs:16` (`pnpm run demo:ptc`) | no — it launches `gnk --profile headless` with `GNK_TOOLS_MODE=ptc` (`packages/bundle/headless/cordis.patch.yml:15`) | yes |
| `apps/web/tests/smoke-real.e2e.ts:593-634` | no | yes |
| `snapshots/session/ptc-*` and `both-mode-turn` | no — `snapshots/session/ptc-turn/cordis.yml:21-24` sets `tools.mode: ptc` on the host row | yes |
| `snapshots/web/ptc-round` via `apps/web/tests/ptc-round.e2e.ts:33` | **yes** | no |
| `apps/web/tests/shipped-composition.e2e.ts:198-205`, `apps/cli/tests/web-agent-presets.e2e.ts:363` | **yes**, by explicit mount | no |
| `packages/preset/agent-presets/tests/shipped-root.spec.ts:85-115,145-167` | **yes**, roster and composition pins | no |

The correction worth recording: `demo:ptc` and the session snapshot corpus exercise the presentation mode, not the preset, so "keep `test:snapshot` and `demo:ptc` working" does not by itself keep `presets/ptc/` alive. The preset is what the Web replay, the shipped-composition pin, and every recorded PTC session resolve.

## Alternatives considered

**`mode: 'both'` as the shipped Standard default.** Rejected by measurement rather than by the owner's instruction alone: it adds 33,133 bytes of catalog to every step of every Standard session in the composition where the cost is pinned, and it emits each tool contract twice in the same request. The same option is free when a session actually asks for code, which is the asymmetry the lazy path exploits.

**Delete `presets/ptc/` and move its rows into `standard/agent.cordis.yml`.** Rejected: every session recorded under `ptc` stops opening, because resume passes the recorded id explicitly and the `standard` substitution is deliberately limited to unnamed requests (`packages/preset/agent-presets/src/index.ts:356-358`, `packages/api/session-controller/src/agent.ts:442,477-479`). This is the same failure the pill decision rejected, reached from the other direction.

**Rename `ptc` and ship an alias map.** Rejected for M1: an alias has to be consulted on every explicit path too — `resolve`, `standingKeyFor`, `compositionInventory`, and the authoring operations — and the roster has no alias concept today. The pre-release stance permits rejecting old formats only where a format change is the point; here it would strand user-authored presets that copy the id.

**Keep `run_code` always registered as an ordinary tool and teach the SDK through a skill.** Rejected on the contract: `run_code` is reserved outside the registration layers precisely so no per-agent restriction or shadow can remove or fake PTC's only entry point (`packages/core/tools/src/index.ts:905-925,1045-1047`), and `view()` only appends it for a non-native mode. Making it an ordinary capability would reopen the bypass the executor collapse closed (`packages/core/tools/src/index.ts:1315-1317`).

**Switch the session's preset on demand through `select` or `recompose`.** Rejected as the mechanism: `select` refuses once a turn has opened (`packages/preset/agent-presets/src/index.ts:748-756`), which is the whole point of a mid-task escalation, and `recompose` carries no such check because its caller owns it (`packages/preset/agent-presets/src/index.ts:664-667`) — routing the lazy path through a preset switch would mean weakening a documented lock and replacing the agent's composition rather than adding one surface to it.

**Delegate a PTC child from a Standard parent.** Not available today: children inherit the parent's preset through `composeFrom` (`packages/subagent/subagent/src/child-agent.ts:144,204`) and `SubagentStartRequest` has no preset field. Recording it as unreachable rather than rejected, since cross-preset children are Maestro G1 scope (`docs/plan-v0.3.4.md:141`).

**Implement first and measure after.** Rejected by the plan's own ordering: the delta map is listed as the required first step, and the two negative constraints are only checkable against a measured baseline (`docs/plan-v0.3.4.md:25-31`).

## Acceptance criteria

- The delta table's rows match source at merge time: `diff` of `packages/preset/agent-presets/presets/{standard,ptc}/agent.cordis.yml` still returns only the header prose, `tool-workflow`'s `disabled: true`, and the `tool-presentation` row.
- Every byte claim resolves to a committed artifact, and each claim that needed a keyed request is marked NOT MEASURED rather than estimated.
- The stale-default section matches `AgentPresets.resolve()` as shipped, distinguishing a new session on an unnamed default from a resumed session on a recorded id.
- The replay inventory names each fixture's actual dependency, preset directory versus host-row mode, so a later change can tell which breakage is real.
- A follow-up implementation cites this note as its baseline, records the before-and-after model-visible bytes for one Standard request with and without activation, and updates `pnpm run test:snapshot` plus both SDK projections in the same change.
- `pnpm run verify-agent-note-format` and `pnpm run verify-agent-note-classification` pass on this file.

## Risks

**The byte figures are composition-specific.** They come from the headless replay composition, whose 26 visible tools match the shipped Web roster in count but not in every description; a shipped-preset measurement could differ by kilobytes in either direction. Treating 32,190 as the exact Web SDK size would be a fabricated precision, so the note marks it NOT MEASURED for that surface.

**`both` on a live session breaks the request prefix once.** The catalog is inside the frozen header, so activation is a `request/header` change with a new series (`packages/core/agent-loop/src/agent.ts:498-518`), and a per-step trigger would pay a break every step. Nothing in this note proves the break is affordable; it is the first thing the implementation must measure.

**A logged toggle that only adds surface still duplicates contracts.** `both` carries each tool twice by design; the lazy path limits when it happens, not whether. If models ignore `run_code` once it is offered, the right answer is the deferred narrower projection, which is a `gnk-tools` change and is explicitly waiting for that evidence ([Per-tool visibility tiers](../../implemented/feature/2026-06-15-ptc.md)).

**The profile gap is a load-time failure, not a graceful degrade.** `presentAs('both')` without `ctx.codeRuntime` throws at assembly through `requireCodeRuntime` (`packages/core/tools/src/index.ts:1010-1020`), which is the intended misconfiguration posture but means a Standard session under `sdk` or `acp` fails the moment it opts into code unless those bundles add the row.

**This note partially supersedes the pill decision without closing it.** [PTC pill removed](../../implemented/simplification/2026-10-24-ptc-pill-removal.md) remains authoritative for what shipped and states its own decision as complete; the ledger records M1 as DONE-VERIFIED for the pill only (`2026-10-25-v0.3.4-to-v0.3.6-release-ledger.md:46`). If the lazy path ships, the pill note's "Everything else about PTC is deliberately untouched" becomes false and the two notes need consolidation under the [Agent Note rules](../../README.md) rather than a third record of the same subject.

**Research was read-only and single-pass.** No test, snapshot, or profile was executed, so every claim here is static source plus committed artifacts; runtime assertions such as "a Standard session opens unchanged after this note" are unverified until the implementation's own coverage says them.

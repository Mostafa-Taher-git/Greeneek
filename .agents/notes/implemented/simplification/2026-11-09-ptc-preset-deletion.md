# Agent Note: The shipped `ptc` preset is deleted; CTC carries its capability

Status: implemented

## Problem

The shipped `ptc` preset duplicated the per-session CTC opt-in: one standing composition plus a `tool-presentation` row for gear the user toggle already reaches, a `retired: true` marker and its client filters, a `ptc`-keyed default sanitizer and its cordis event, display copy in three dictionaries, and five test surfaces pinning the preset's row set. The roster kept a second shipped way to get `run_code` long after the new-session pill left, and every catalog and README had to name both the preset and the mode.

## Decision

**`presets/ptc/` is deleted, and with it every surface that exists only for it.** The shipped root now carries six presets (`army`, `cordis`, `instructor`, `maestro`, `pixels-designer`, `standard`). The `retired` marker is gone from `PresetMetadata`, `AgentPreset`, and `AgentPresetRow`, from `readPresetMetadata`/`renderPresetMetadata`, from the client option and section stores, and from both roster filters; no shipped preset carries it. The `ptc`-keyed unnamed-default branch (`RETIRED_DEFAULT_PRESET_ID`) and the `agent-preset/default-sanitized` event are gone as well: `resolve()` keeps the generic unknown-default fallback to `standard` with a warning, and an explicit id the roster lacks fails with `agent-preset/not-found`. The `ptc` entry of `BUILT_IN_PRESET_KEYS` and the `presetPtcName`/`presetPtcDescription` keys in all three dictionaries are removed. No bundle row names the preset: presets ship inside `gnk-agent-presets`, and the only bundle roster row is the Web default `standard`. The PTC presentation mode itself — `tools.mode: 'ptc'`, the `run_code` transport, the generated SDK, and the `ptc-*` session snapshots, which ride the host row rather than the preset — is unchanged.

**The `ptc-round` web scenario is repointed to Standard plus CTC.** The scenario now boots the `standard` preset with `toolsMode: 'both'`. Its committed `snapshots/web/ptc-round` artifacts still record the pre-repoint composition and are not refreshed on this host: replay stays BLOCKED until a POSIX re-record rewrites the session log and sidecars.

**Composition and parity coverage moved to methods that outlive the preset.** The `web-agent-presets` e2e asserts CTC isolation (a `both` agent beside a native neighbor) and the CTC transport-plus-catalog directly instead of against a `ptc` baseline, and the shipped-SDK panel that pinned the preset's `tool-workflow` disable is removed with the preset. The configured-roots test stages the narrow composition for its user preset and `standard` for the shadowed-id case. Session-controller hosts now prove the toggle cycle end to end: the registry-level test reads the assembled `run_code` schema and `tools:sdk` section through enable, disable, and re-enable on a toggled session, and the replay test re-adopts the stored session and reads the folded `both, native, both` sequence back, including a session that ends on `native`.

A stored session naming the deleted preset fails loudly rather than silently becoming `standard`: `resolve('ptc')` and every explicit resume, adopt, and cold-transcript read throw `agent-preset/not-found`, while a new session whose stored default names `ptc` composes `standard` with the existing warning. The migration for a recorded session is a new `standard` session with CTC enabled (`presentCtc` with `enabled: true`); the release note carries that sentence.

## Alternatives considered

**Keep the retired preset (Branch B).** Rejected: it keeps the second shipped composition, its copy, and its pins in the tree indefinitely, and leaves the roster naming a preset the product no longer offers. The census recorded zero PTC sessions in the owner's store, and CTC covers the capability per session, so retirement preserved nothing the toggle does not reach.

**Keep the `retired` marker as generic machinery.** Rejected: no shipped preset carries it, so the marker, both filters, and the metadata read/write path are dead code with no producer. A future removal needs only the generic unknown-default fallback and the loud explicit failure, both already shipped.

**Silently migrate a stored PTC session to Standard with CTC enabled.** Rejected: the session's history was produced under a composition whose tools and SDK it named, and substituting another would misreport that record. The loud `agent-preset/not-found` plus the documented migration is the pre-release stance.

**Repoint `ptc-round` at host-row `ptc` mode instead of `both`.** Rejected: the master plan requires Standard plus CTC, and `ptc` alone would drop the native tools the fixture's ordinary catalog carries. `both` is the mode the CTC toggle already proves.

## Consequences

There is exactly one shipped way to reach `run_code` in a new session: the CTC opt-in on `standard`, recorded as `tool/present-as` and reconstructable on resume. A session recorded under the deleted preset does not open; it fails with `agent-preset/not-found` naming the missing id and the roster, and the owner continues under a new Standard session with CTC enabled. The `ptc`-only facts — the disabled `tool-workflow` row and the collapsed single-tool wire — survive only as history and as the parity assertions in the tools and CTC tests. The `ptc-round` fixture remains red until the POSIX re-record lands, and the census re-run at deletion time remains a release gate; this change relies on the 2026-11-06 census (52 artifacts, 0 naming `ptc`). The `cordis` skill's off-limits paragraph no longer enumerates the shipped set, so it cannot rot with the next preset change.

## Verification

- `packages/api/session-controller/tests/session-present-ctc.host.spec.ts` (13 tests) covers the registry-level toggle cycle and the resume replay described above, beside the existing cycle, idempotency, refusal, and undo cases.
- `packages/preset/agent-presets` and `packages/client/ui-agent-preset` suites (88 tests across the shipped-root, display, metadata, locales, section-store, and components specs) pin the six-preset roster, the fallback and loud-failure proofs, and the removed dictionary keys.
- `packages/api/session-controller`, `packages/preset/agent-presets`, `apps/cli/tests/windows-shell.spec.ts`, and `apps/cli/tests/preset-plugins.spec.ts` together pass 650 tests. `apps/cli/tests/web-agent-presets.e2e.ts` CTC isolation, transport-plus-catalog, roster, and configured-roots cases pass against an isolated `GNK_HOME` on this host.
- `pnpm run verify-client-ui-i18n` reports 527 Client UI files locale-owned; `pnpm run verify-cordis-config` reports 137 files passed; `pnpm run verify-cordis-catalog`, `pnpm run verify-cordis-api`, `pnpm run verify-plugin-catalog`, and `pnpm run verify-doc-graphs` are fresh for the regenerated `docs/subsystems/core.md`, the tool-Cordis API catalog, `docs/plugin-catalog.md`, and `docs/event-producer-consumer.md`.
- Root `pnpm run typecheck`, `pnpm run lint`, `pnpm run verify-generated-artifacts`, and `pnpm run test:docs` remain red on inherited in-flight work unrelated to this deletion: three type errors in `packages/api/session-controller/tests/no-provider-key.host.spec.ts`, `packages/util/home-paths`, and `scripts/build-exe-for-python-sdk.spec.ts`; the tool-catalog and slot-catalog staleness from the in-flight `tool-owned-render` package; and the `AGENTS.md` word budget (1978 over 1950). Package-level typechecks for `agent-presets`, `session-controller`, and `ui-agent-preset` and a narrow `oxlint` pass over the changed files are clean.

## Related

- [The CTC opt-in keeps its disposer, so the user can withdraw it](../feature/2026-11-01-ctc-reversible-presentation.md) — the toggle and projection fold this deletion leaves as the single path.
- [PTC pill removed from the new-session row](../simplification/2026-10-24-ptc-pill-removal.md) — the retirement this note completes; its "deliberately untouched" sentence is superseded here.
- [Preset retirement marker](../architecture/2026-10-29-preset-retirement-marker.md) — the `retired` machinery deleted here; partially superseded.
- [Per-agent tool presentation, and the `ptc` preset](../feature/2026-08-05-per-agent-tool-presentation.md) — the scope and lock this note narrows to CTC; partially superseded.
- [PTC preset omits the general workflow tool](./2026-09-01-ptc-omits-workflow-tool.md) — the composition deleted here; partially superseded.
- [Greeneek v0.3.9 — Master Release Plan](../../proposed/process/2026-11-01-v0.3.9-master-release-plan.md) — S1-08 and S1-20 through S1-25.

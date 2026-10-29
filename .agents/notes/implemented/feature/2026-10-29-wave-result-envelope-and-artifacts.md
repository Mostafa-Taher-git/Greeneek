# Agent Note: Wave settled results gain an engine-owned envelope and validated artifact pointers

Status: implemented

## Problem

A settled wave member returned one flat record that mixed the engine's account of the settlement — the truncation flag, the terminal stop reason — into the same fields as the child's payload, with no versioned seal a reader could tell apart from model output. `WaveMemberView.artifacts` was simultaneously a declared field with no source: the subagent result reports output, a structured value, a diagnostic, and a stop reason only, so no fleet row could show what a member produced as files or URIs, and the Lead had to re-read member transcripts to recover artifact locations.

## Decision

Every settled member now returns beside an engine-owned `WaveResultEnvelope` (`schemaVersion: 1`, `heartbeatAt`, `truncated`, optional `stopReason`, and a reserved `externalSessionId` this engine version never writes), and the member's structured result may name artifacts that the engine validates before publishing.

- **The envelope is engine metadata only.** Each field is computed at the single settlement funnel in `resultOf`; nothing is read from or written by the member's model output. `WaveMemberResult` nests the capped payload under the envelope — the former flat `truncated` and `stopReason` fields moved inside it — so a reader can treat unknown envelope fields as ignorable as the contract version advances.
- **Budget spend stays on the row, not in the envelope.** The v0.3.7 plan's envelope item named engine-owned `budgetUsed` as an envelope field; the envelope carries no spend. `tokensUsed` and `budgetUsed` already live on the inherited engine-owned view fields as the `tokenUsage` projection's cumulative reading, and duplicating that number would create two homes that can diverge. This note records the deviation from the plan's literal wording.
- **`validateArtifacts` is the only pointer origin.** A member's settled `structured` value may carry a reserved `artifacts` property; the promotion keeps closed `{kind:'file', path}` / `{kind:'uri', uri}` entries only, with paths ≤ 1024 UTF-8 bytes free of control characters, absolute HTTP(S) URIs ≤ 2048 characters, and at most `MAX_WAVE_ARTIFACTS` (16) pointers per member, first valid winning. The validator never throws: a malformed claim is dropped and the member's raw structured value stays available to the Lead beside the vetted pointers. The member's prose output is never a pointer source.
- **`WaveArtifactPointer` replaces the unsourced string shape.** The view field populates only after settlement — a running member carries none — and the same pointers propagate to the `wave/member-settled` and `wave/settled` durable rows, the tool report rows and their model-facing `artifacts: …` text line, the fleet mirror's change signature, and a Fleet-panel count chip whose hover title lists the addresses (zh/en/ar copy).
- **`wave_dispatch` accepts a per-member `output_schema`.** `parseDispatchArguments` asserts each declared schema with `assertObjectJsonSchema` and names the member in every violation (`members[i].output_schema: …`); the validated schema forwards as `WaveMemberRequest.outputSchema` to the subagent seam, which already enforced the subset on its own start path.

## Alternatives considered

**Inferring pointers from the member's prose output.** Rejected: prose is untrusted child text, and an inferred path or URL can name an artifact the member never produced. The reserved structured property keeps authorship explicit and the plan forbids prose inference outright.

**Keeping the flat `truncated`/`stopReason` fields beside a new envelope.** Rejected: two homes for the same facts let them drift, and the flat fields are exactly the engine-account/payload mixing the envelope separates.

**Rejecting the whole structured value when any pointer claim is malformed.** Rejected: one malformed entry would discard a valid payload the Lead can still read raw; dropping the claim loses nothing.

## Consequences

- The envelope's `heartbeatAt` is the seal's wall clock, stamped when `resultOf` seals the result; it is not the member's launch-to-settlement duration, which stays on the view's `durationMs`.
- A validated pointer is the child's claim about a location, not a host-verified existence check; a consumer that needs existence must stat the path itself, and none does yet.
- The Fleet panel renders pointers as a count with hover addresses; a per-artifact drawer listing is the next Army Fleet slice.
- The generated persistence, tool, config, and cordis catalogs regenerate with this change; the known event-type set is unchanged because the events already existed.

## Verification

- `packages/subagent/wave/tests/artifacts.spec.ts` holds the validator's behavior: order preservation, closed-shape and unknown-kind rejection, byte-exact multibyte path bounds, control-character rejection, scheme and length bounds on URIs, and the count cap with invalid entries not consuming budget.
- The wave engine suite's artifact/envelope block covers outputSchema passthrough to the subagent seam, pointer promotion onto the envelope, live view, and both durable rows, the no-pointers state of a running member, malformed-claim drops with prose never read, the count cap, and a failed member's seal.
- The tool-wave suites pin the full report row with `artifacts`, the model-facing artifacts line, and the `output_schema` passthrough plus its violation-list rejection; the ui-wave suites pin the mirror's republish when pointers arrive and the panel's count chip with its title.
- `wave` + `tool-wave` 91 tests, ui-wave 54 tests, and `test:gui` 4189 passed / 1 skipped; `typecheck`, `lint:contracts-ready`, and all six generated-artifact freshness checks green.

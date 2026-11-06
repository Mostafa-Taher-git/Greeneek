# Agent Note: The CTC opt-in keeps its disposer, so the user can withdraw it

Status: implemented

## Problem

The per-session code-tools opt-in (CTC) could only be turned on. `ToolRuntime.presentAs(mode)` is turn-1-final per scope — a second declaration on a live scope answers with `ToolPresentationLockedError` — and the Session Controller dropped the disposer that call already returns. A user who enabled CTC stayed enabled for the life of the session, and the composer chip offered one action in one state with no way back. Starting a new session to undo a switch the same session made is not a cost a user will name in advance.

The label hid the second half of the complaint. "Code tools" said nothing about the mechanism (`run_code` beside the ordinary tool list) or its price (a system prompt that grows every turn), so the menu carried no sentence a reader could decide on.

## Decision

**The controller records the declaration it owns.** `packages/api/session-controller/src/presentation.ts` keeps a `WeakMap` from an agent's own context to its disposer — `rememberPresentation`, `releasePresentation`, `holdsPresentation`. A preset composition declares through the same `presentAs` call on a standing scope and never enters that registry, so the Session Controller distinguishes its own declaration from a deployment's without asking the tools registry to track ownership it has no use for.

**The remote takes a desired state.** `session.presentCtc` accepts `enabled` (absent means `true`) and returns the presentation now active, `'both'` or `'native'`. Asking for `both` while the controller already holds a declaration returns that state without a second event; asking to withdraw a session that never declared returns `native` without one. A double click cannot fabricate history.

**Both directions append one `tool/present-as` event per accepted change.** The existing projection fold already returns the latest event's `to`, so replay reproduces every state a toggling session held, and a resumed agent re-declares from that value and enters the registry — a re-adopted Session is withdrawable like a fresh one.

**A refused log write leaves the live scope as it was.** When the append fails, an enable releases the declaration it just made and a withdrawal re-declares, so the request never reports a presentation the model cannot see.

**Withdrawal waits for an idle Agent; enable does not.** Under `both` the scope's dispatch table carries `run_code`. Switching the same scope to `native` removes it, so a withdrawal landing mid-turn would refuse a `run_code` call that the running turn was already given as available. Adding a presentation is additive and simply applies to the next request, so it stays available at any time. The refusal is the typed `tool/presentation-busy`, which the chip renders as "Disable CTC once this turn finishes."

**The chip shows the one change that is available.** `CtcSelect` renders a single row whose id and label follow the folded `presentAs` — opt-in when off, withdrawal when on — and its footer states what CTC does and the measured per-turn prompt cost. The row's own id is the desired state, so the menu never presents two contradictory switches.

## Alternatives considered

**Let `presentAs` overwrite a scope's mode.** Rejected: the lock exists so that a late call cannot fork what the model sees under a composition that selected a presentation on purpose. Reversibility had to run through the disposer, which unwinds exactly what was declared.

**Keep the lock and point the user at a new session.** Rejected: it is the complaint, and it discards the disposer `presentAs` already returns and the session log that already records the declaration.

**Defer a withdrawal to the next request boundary, the way model selection does.** Rejected for now. `agents.selectForNextRequest` writes per-request state the loop reads at assembly; the presentation is registry scope state that prompt assembly and the dispatch table read live, so deferring needs a scheduled declaration path with its own undo, projection, and replay semantics. The idle refusal enforces the same rule with one branch and is retryable a second later.

**Refuse both directions while the Agent runs.** Rejected: enabling cannot strand a call the model planned, and blocking it would withhold the action the switch exists for.

**Track declaration ownership inside `ToolRuntime`.** Rejected: the registry has no user-versus-composition distinction to make, and it would publish a new accessor for one consumer. The `WeakMap` lives at the seam that already knows who declared.

## Consequences

`tool/present-as` is no longer at-most-one-per-session: a session log can carry a declaration, a withdrawal, and a re-declaration. Any reader that assumed one winning declaration per scope must take the last event; the projection fold and the resume path already do, and both are covered by the toggle test.

The presentation lock now protects compositions only. A preset that mounts `both` or `ptc` still refuses a user re-declare, and the chip surfaces that as `tool/presentation-locked`, so the asymmetry a user can trigger is deliberate and stated in copy rather than inferred from a silent failure.

Two more wire-visible facts join the call: a `codeRuntime` refusal (`tool/code-runtime-required`) when the deployment mounts none, and `tool/presentation-busy` for a mid-turn withdrawal. Each maps to its own chip message, so a refusal never reads as a generic write failure.

## Verification

- `packages/api/session-controller/tests/session-present-ctc.host.spec.ts` covers the enable/disable/enable cycle in one session with one event per change, the idempotent repeat, the never-declared withdrawal, the mid-turn withdrawal refusal with the declaration left in place, enable and withdrawal undo when the log write fails (an `Error` and a non-`Error` throw), a composition-declared presentation refusing the user, the missing-runtime refusal, and a silent re-declaration on re-adopt.
- `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` asserts the off state offers the opt-in, the on state offers the withdrawal instead, each call passes its desired boolean, and every refusal reason reaches the banner with the menu still open.
- `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` pins the wire request as `{ sessionId, enabled }` for both states and each `RemoteError` code onto the chip's reason set.
- `pnpm exec vitest run packages/api/session-controller packages/client/ui-conversation` passes 375 tests, and the changed sources measure no uncovered statement or branch under the per-file coverage report.

## Related

- [Per-agent tool presentation, and the `ptc` preset](./2026-08-05-per-agent-tool-presentation.md) — the scope-state and lock this note narrows to composition-time declarations.

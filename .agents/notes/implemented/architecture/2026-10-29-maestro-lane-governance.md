# Agent Note: Maestro lane isolation and reviewed integration

Status: implemented

## Problem

Continuable teammates shared the Lead checkout. Two teammates writing the same relative path could overwrite each other, a teammate could commit or publish refs directly, and the Lead had no evidence that a merged change was the one it reviewed. The exported worktree primitive created checkouts but nothing used it, so isolation was available only to code outside the Team service.

## Decision

A teammate's lane policy is resolved before any roster entry exists. `readOnly` permits the shared checkout with file-mutating and Git-mutating tools denied. `writeScopes` creates an isolated worktree from the Lead checkout's canonical repository root, requires at least one normalized scope, and refuses overlap with another active lane. A write-scoped spawn outside a Git work tree fails closed. The policy is stored on the durable member snapshot, so a cold resume keeps the same guard.

`LaneLifecycleManager` owns durable records below `<gnkHome>/lanes/<sessionId>/`. It writes a `preparing` record before git creates the checkout, records the canonical path, branch, base revision, and scopes when ready, and checkpoints tracked and untracked changes into one patch plus its SHA-256 hash. A checkpoint verifies the checkout still sits on its base; a moved HEAD quarantines the lane permanently. Explicit discard and merge remove the checkout only after the checkpoint exists. Startup recovery finishes or rolls back only recorded `preparing` and `closing` transactions; a ready lane is never deleted.

`LaneIntegration` serializes merges per Lead and halts that queue on the first refusal. It requires a clean primary checkout, the caller's expected primary HEAD, a fresh checkpoint whose hash equals the reviewed hash, and the gate commands. It applies only the reviewed patch, runs every gate in the primary checkout, commits, and removes the lane. A conflict, gate failure, or commit failure reverses the applied patch when possible and keeps the lane and checkpoint. A queue halt requires an explicit `resume`.

Teammate-scoped tool guards deny `commit`, `merge`, `push`, `tag`, ref mutation, and HEAD-moving Git subcommands through `bash` and `pwsh`, and deny file and self-modification tools in a read-only lane. The shell guard is text-level, so integration independently trusts only the recorded-base HEAD check.

`spawn_fleet` validates every member before showing the approval composer card. The card carries each member's provider, context, preset, model, reasoning effort, token budget, and write capability; only an `allowed-once` decision starts children. A rejection, cancellation, timeout, or absent approval capability creates zero children and zero worktrees.

A teammate may carry a cumulative `maxTokens` ceiling. It requires the `tokenUsage` projection at admission, is stored on the durable member snapshot, and is checked at each step boundary; a breach aborts the child. A missing projection fails the spawn instead of running unbounded.

A repository may declare `.gnk/fleet.json`. Parsing is size-capped, strict, provider-limited to configured in-process fleet providers, and lane-policy validated. Launch requires a one-time approval keyed by the exact file bytes and the canonical repository path; changed bytes need fresh approval and an admitted approval is removed.

`scripts/benchmark-delegation.ts` validates fixed tasks and supplied runs and emits a JSON report. It returns `verdict: null` until every task has one sequential and one Maestro run, so the scaffold cannot claim superiority from no runs.

## Alternatives considered

- **Require every teammate to use an isolated worktree.** Read-only inspection and shared-coordination lanes do not need a checkout, and forcing one would make simple delegation pay Git setup cost.
- **Let teammates commit and merge directly.** A member commit moves HEAD and destroys the recorded-base evidence; integration could no longer prove the reviewed patch was the only change.
- **Merge lane branches instead of patches.** A branch merge can bring unrecorded commits and merge semantics the Lead did not review; applying the checkpointed patch keeps the reviewed bytes authoritative.
- **Delete lanes on every child failure.** An error or cancellation can follow useful uncommitted work; keeping the checkout and checkpoint preserves the only copy.
- **Enforce the token ceiling with a request-time output cap.** An output cap bounds one response, not cumulative spend across steps; the step-boundary meter is the ceiling the fleet card promises.
- **Trust repository fleet providers documented by their own CLIs.** Only providers this deployment can launch in-process are accepted; documentation alone is not capability evidence.

## Consequences

- A write-scoped teammate runs in its own checkout; the Lead merges its reviewed patch serially with gate evidence.
- A moved lane HEAD is detected and quarantined even when a shell guard was bypassed.
- Lanes survive idle, cold resume, cancel, error, and Team disposal; only explicit discard or successful merge removes a checkout.
- Fleet spend is gated by an approval card and by a byte-keyed one-time repository approval.
- `spawn_teammate` and `spawn_fleet` accept model, reasoning-effort, token-budget, read-only, and write-scope fields; the tool and configuration catalogs are regenerated.

## Verification

- Lifecycle tests cover create failure cleanup, overlap refusal, checkpoint hashes and patch application, oversized patches, moved HEAD quarantine, discard preservation, interrupted create and close recovery, and record validation.
- Integration tests cover reviewed merge, empty no-op, primary movement and dirtiness, stale review, gate reversal, rollback failure, commit failure, conflict, moved HEAD, serialized admissions, and unknown lanes.
- Team tests cover isolated spawn, disjoint scopes, non-Git refusal, read-only policy, token budget admission and enforcement, disposal checkpoint, repository fleet approval, and a three-lane heterogeneous-preset serial merge with a final conflict-free primary.
- Tool tests cover guard detection, the four new tools, fleet validation and rejection, launch failure, and approval absence.
- The changed packages report 100% statement, branch, function, and line coverage; the benchmark tests cover invalid tasks, invalid runs, partial coverage, and verdict rules.

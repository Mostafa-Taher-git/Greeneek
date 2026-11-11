# Agent Note: Upstream P0 ports from DeepSeek Harness 0.2.2

Status: implemented

## Problem

Greeneek forked DeepSeek Harness at `818c4f344e` (release `0.1.2-rc.1`, 2026-09-03). Upstream HEAD `fcc0ad46` (release `0.2.2-rc.1`, 2026-11-04) is 10,847 commits ahead. Four P0 items were carried into this fork's queue: (P0-1) pi-ai 1.3 route split/catalog/replay/thinking plus malformed-args handling, (P0-2) chat secret masking, (P0-3) pending-Inbox restore after restart plus a cross-process session lease, and (P0-4) MCP repeated-cursor rejection. Each needed a per-item verdict — ported, adapted, or rejected — with evidence, not a blanket merge. The fork point was re-verified before any port: `scripts/gen-third-party-notices.ts` still records `818c4f344e` and `THIRD_PARTY_NOTICES.md` renders the same record.

Four reference harnesses were studied where they held product precedents: upstream DeepSeek Harness itself (the source of every port), plus pandacode, t3code, and delegate-skills for cross-harness pattern checks on secret masking and process leasing. None of the three outside references is a code source here; they informed the shape decisions only. All reused code is DeepSeek Harness MIT work, preserved under the repository LICENSE and `THIRD_PARTY_NOTICES.md`.

## Decision

**P0-1 — pi-ai 1.3: ported (dependency bump plus the replay/thinking additions), malformed-args failure kept stricter than upstream.** `@greeneek/gnk-llm-pi-ai` moved from `@earendil-works/pi-ai ^0.87.1` to `^1.3.0` (verified the resolved tree against `1.5.0` and rejected it: 1.5.0 adds `SystemOneCompat` drift and a wider `ChatTemplateKwargValue` that this adapter does not need). The adapter's route split (per-route `Provider` built from a static protocol), catalog materialization, and thinking-level scale already matched upstream's shape from the Greeneek side, so the port landed as three edits: (a) `supportsMidConvoEffort` added to the Responses compat gate — pi-ai 1.3 adds that field to `OpenAIResponsesCompat`, and the profile doc now names the three Responses protocols beside `anthropic-messages`; (b) the `chatTemplateKwarg` schema cast at the boundary, because pi-ai 1.5 models `$var` as required while schemastery's object keys are nullable-optional, which is wider under `exactOptionalPropertyTypes` — the cast is the verdict, runtime validation stays required-`$var` plus boolean `omitWhenOff`; (c) `providerThinkingLevel` on the replay response half and `namespace` on the tool-call block half, mirroring upstream `replay.ts` at HEAD, with validation in `readReplayState` and restoration in `replayedAssistant`; (d) the Azure provider route rename (`azure-openai-responses` → `azure`, upstream `d79f13a4d4`) in the Responses compat test, and the stored-profile directory test now names `openai` (codex is OAuth-only, so an `apiKeyEnv` profile no longer yields a row — the default-directory row for codex is still offered). Malformed-args handling was not downgraded to match upstream: upstream HEAD (`parseArguments`) still tolerates any non-object JSON as `{}`, while Greeneek's version fails arrays and `null` with `INVALID_TOOL_ARGUMENTS_CODE` — verified already present at `replay.ts` and kept, since silently rewriting a tool call to empty arguments is the defect P0-1 names. Tests: new replay round-trip case for `providerThinkingLevel`/`namespace` in `convert.spec.ts`, plus the existing non-object-args rejection case.

**P0-2 — chat secret masking: adapted, not ported as a plugin.** Upstream ships this as the `ui-secret-mask` Client plugin: a `UserTextRule` matcher plus a keyed `conversation.user.text.node` renderer registered through the UserText registry, scheduler, and node-slot machinery (`commit a93958c7d0` and follow-ups: module split `1681948e3f`, key-block confinement `035d78d4c8`). Greeneek has none of that machinery: there is no `UserTextRegistry`, no `UserTextRule`/`UserTextNode` types, and no `user-text-registry.ts`/`whitespace-rules.ts` under `ui-conversation` — only the `projectUserText` projection in `ui-primitives` plus reference chips. Copying the plugin verbatim would strand the package without a host. The adaptation ports the genuinely portable core — the four pure modules (`credential-formats`, `format-tables`, `credential-masks`, `credential-scanner`, MIT) — into `ui-primitives/src/secret-*.ts` and `secret-mask.ts`, which scans the whole sent text and renders each credential range masked inline in `projectUserText` (with `data-secret` marks) while all other rendering is untouched. The logged message, copy actions, and model input keep the original characters; only drawn text changes. The reveal-toggle button from upstream's `SecretText` is not ported: Greeneek's projection has no interactive per-node surface, so this change draws masked text only. Tests: new `projectUserText` masking case (`sk-` credential masked, plain prose untouched) in `user-text.client.spec.tsx`.

**P0-3 — pending-Inbox restore plus cross-process session lease: restore verified, lease adapted.** Restore was verified rather than changed: `Inbox` in `packages/core/agent/src/inbox.ts` already replays durable `agent/inbox/spliced` events from `session.ownEvents()` in its constructor, so a restarted agent resumes with its pending `nextTurn`/`nextStep`; the existing `resume.spec.ts` background-job case (`a2.inbox.nextStep` contains the finished job after a second agent) pins exactly this path, and the host control stream already rebases the queue from the live agent's inbox after open (`control.ts` baseline plus `agent/inbox/spliced` broadcasts). Greeneek's `queue-store.ts` is a pure projection over the session snapshot, not a second local store, so there was no local queue to delete as upstream did. The lease was the real gap — both READMEs named it the "planned next layer" — and is now implemented as an adaptation of upstream `session-persistence-jsonl/src/lease.ts` (MIT): same lease shape and no-expiry rule, but an exclusive-create `session.lock` file carrying the holder pid instead of upstream's native `flock` plus Win32 named-semaphore pair, because Greeneek ships `@greeneek/node-addon-landlock-run` and no `node-addon-system` flock addon. A dead holder's pid is reclaimed via the `process.kill(pid, 0)` liveness check; a live holder refuses with `SessionAlreadyOwnedError`. The handle acquires before its first materializing append or flush and releases idempotently on close; readers never touch the lock. Tests: `tests/lease.spec.ts` (second live holder refused, dead-pid reclaim plus idempotent release). `storage.ts`, `index.ts` (`acquireWriteLease`), and the lease module carry the implementation.

**P0-4 — MCP repeated-cursor rejection: ported verbatim.** `syncTools` in `packages/mcp/mcp-client/src/tools.ts` now tracks `seenCursors` across the `tools/list` pagination drain and throws `mcp-client(<server>): server repeated a tools/list continuation cursor — invalid tool list` on a repeat, before any registry swap, exactly as upstream commit `594305ce19` (`fix(mcp): reject repeated tool discovery cursors`). The fetch-phase doc line now names repeated cursors beside duplicate names and network errors. Test: new `rejects a repeated tools/list continuation cursor and keeps the previous generation` case in `mcp-client.spec.ts`.

## Alternatives considered

**P0-1 blind version bump to latest (`1.5.0`).** Rejected: it compiled only after chasing `SystemOneCompat` and chat-template drift that upstream 0.2.2 itself does not consume; the task pins 1.3, so the tree is pinned to `^1.3.0` with the 1.5.0 attempt recorded here.

**P0-1 accept upstream's tolerant `parseArguments`.** Rejected: upstream still coerces arrays/`null` to `{}`; Greeneek fails them loudly with `INVALID_TOOL_ARGUMENTS_CODE`. Loosening would silently rewrite model tool calls.

**P0-2 copy the `ui-secret-mask` package wholesale, with a UserText registry shipped alongside.** Rejected: it drags the whole upstream UserText scheduler, whitespace rules, and conversation node-slot stack into Greeneek for one masking surface. The scanner is pure and portable; the plugin seam is not present. Adapted into `projectUserText` instead. Reintroducing the full registry is future work with its own Note.

**P0-2 no masking in `projectUserText`, masking only where the control stream shows queue rows.** Rejected: bubbles, queue rows, and echoes all flow through the same projection; masking at the projection covers every caller at once.

**P0-3 full upstream Inbox-as-projection refactor.** Rejected for this slice: it moves `Inbox` from the agent-owned class to a session-projection unit (`stateVersion: 1`), touches every queue consumer, and is not needed to prove restore — restore already works through constructor replay. The host baseline change (cold-session queue from the durable log) is deferred; today a cold session shows no queue until its agent opens, then the restored rows arrive.

**P0-3 native `flock` plus Win32 semaphore copy.** Rejected: it needs the `node-addon-system` native addon, which Greeneek does not ship. The pid-file lease keeps the same invariants (kernel-independent, no expiry, contention as `SessionAlreadyOwnedError`) with zero native dependencies and both Windows and Linux behavior.

**P0-3 stale-lease expiry timer.** Rejected on upstream's own reasoning: a wedged-but-live writer must keep its lock; only a dead pid is reclaimed.

**Filing all four as one blanket upstream merge.** Rejected: each item has a different verdict (ported, adapted, verified), and the rejected-items list below must not travel silently with the ports.

## Rejected upstream items (not adopted, with reasons)

- **Session V-migrations (`session-format-v0-to-v1`, `session-log-v3`/`v4` migration packages).** Rejected: Greeneek keeps `SESSION_FORMAT_VERSION` pinned at `0` with no compatibility promise; backends reject old formats by design. Accepting migration packages would contradict the pre-release stance.
- **`ptc-runtime` rename.** Rejected: Greeneek's CTC work is recorded under the `tool/present-as` presentation; no upstream rename maps to a Greeneek need.
- **E2B removal.** Rejected: the E2B sandbox composition is a shipped Greeneek provider with its own contracts; upstream's removal is a product choice, not a defect fix.
- **Hot-reload rollback removal and `both`/invariant removal.** Rejected: rollback and the invariant-companion policy are Greeneek-owned mechanisms with their own gates and Notes; upstream's structural simplification does not apply.
- **Private-IP fetch blocking.** Rejected: private-network egress rules belong to Greeneek's egress policy and Settings surface; the upstream web-fetch default change is not adopted by this slice.

## Reuse ledger

| Source (MIT, DeepSeek Harness @ `fcc0ad46`) | Reused | Where / form in Greeneek |
|---|---|---|
| `packages/mcp/mcp-client/src/tools.ts` (`594305ce19`) | 13-line cursor guard | Verbatim logic in `syncTools`; error text matches upstream |
| `the retired ui-secret-mask client/` (`a93958c7d0`…`94d4007bfd`) | `credential-formats`, `format-tables`, `credential-masks`, `credential-scanner` | Adapted copies as `ui-primitives/src/secret-*.ts` (imports retargeted, `UserTextNode` replaced by local `SecretRange`); plugin/registry/SecretText/locale layers not copied |
| `packages/session/session-persistence-jsonl/src/lease.ts` | Lease shape, no-expiry rule, `SessionAlreadyOwnedError` mapping | Adapted as `session-persistence-jsonl/src/lease.ts` (pid file replaces flock/semaphore; sync fs so fake-timer suites pass) |
| `packages/llm/llm-pi-ai/src/replay.ts` + compat schema | `providerThinkingLevel`, tool-call `namespace`, `supportsMidConvoEffort` gate | Added fields and gate entries; `parseArguments` deliberately kept stricter |
| Upstream `inbox.ts` projection + `durable-inbox-web-recovery` | Restore semantics only | Verified already implemented via constructor replay; projection refactor deferred |

Notices: no new external npm dependency beyond the `pi-ai` version bump was added (`@earendil-works/pi-ai` was already a disclosed runtime dependency); `pnpm run gen-third-party-notices` regenerates cleanly. LICENSE already carries both copyright notices.

## Compatibility matrix

| Item | Windows | Linux | Evidence |
|---|---|---|---|
| P0-1 pi-ai `^1.3.0` + replay/thinking | Green (code + typecheck) | Unvalidated (no Linux run in this slice) | `tsc -b packages/llm/llm-pi-ai --force` passes; `convert.spec.ts`, `catalog.spec.ts` pass; live-provider e2e not run (needs a key) |
| P0-2 masking in `projectUserText` | Green | Unvalidated | `user-text.client.spec.tsx` passes (10 tests) |
| P0-3 pid-file lease | Green | Green (pid liveness is portable; file is lock-path only) | `session-persistence-jsonl/tests` 193 pass including new `lease.spec.ts`; fake-timer suites unregressed |
| P0-3 Inbox restore | Green (verified, no change) | Green (verified, no change) | `resume.spec.ts` inbox case; constructor replay in `agent/src/inbox.ts` |
| P0-4 MCP cursor guard | Green | Green (pure logic) | New `mcp-client.spec.ts` case passes; full `mcp-client` file run at port time |

## Consequences

The fork's LLM stack now consumes pi-ai 1.3 with upstream's thinking and namespace replay fidelity, while tool-call arguments stay fail-loud. Sent user text masks recognized credentials at the single projection every bubble, queue row, and echo shares, without touching model input. Session writers are now mutually exclusive across processes, and pending inbox work survives restarts through the existing durable replay. MCP servers that repeat a continuation cursor fail the sync before touching the registry. The deferred items — the full UserText registry, the Inbox-as-projection refactor with cold-session queue baselines, and pi-ai 1.5 — remain reachable without redoing this slice.

## Related

- Upstream commits: `d6398b3c86` (pi-ai 1.3.0), `594305ce19` (MCP cursor), `a93958c7d0` (secret mask), `31209ea9d7` (durable inbox merge), `fcc0ad46` (HEAD).
- [Handle-based session persistence](../architecture/2026-08-27-handle-based-session-persistence.md) — predecessor that planned this lease layer.
- [Executed upstream attribution gates](2026-10-23-executed-upstream-attribution-gates.md) — fork-point record ownership.

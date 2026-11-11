# Agent Note: Five-round debate with a dedicated moderator

Status: implemented

## Problem

`runDebate` ran independent positions plus alternating objection/rebuttal rounds and synthesized through a seat named `${participants[0].name}-synthesizer` on the first participant's provider, with a boolean consensus and unresolved list as the whole verdict. The transcript carried no evidence role, no minority position survived a majority, and the synthesis voice shared the first participant's identity, so a reader could not tell whether the verdict was an independent decision or the first seat grading its own work.

## Decision

`runDebate` in `packages/subagent/agent-team/src/debate.ts` runs five phases in order: Independent Proposals (`position`, round 0), Cross-Examination (`objection`), Rebuttal (`rebuttal`), Evidence Review (`evidence`, once after cross rounds when `maxRounds > 0`), and Final Synthesis (`synthesis` through the dedicated moderator). Every turn keeps its participant name and source Harness (`sourceHarness`) in the transcript the next phase reads.

The moderator is a separate seat (`DebateRequest.moderator`, resolved to `moderator` on the `spawn` connection when omitted) with its own provider and speaking name, and `runDebate` refuses a moderator name that collides with any participant. The synthesis entry records the moderator's name and provider, never `participants[0]`. `TeamService.conductDebate` keeps the live-collection wiring from [live debate collection](2026-11-08-live-debate-collection-contract.md) and validates the moderator name before anything spawns; `gnk-tool-agent-team` exposes the moderator as an optional `conduct_debate` parameter and returns the moderator fields in the tool result.

The moderator publishes one `VERDICT:` line choosing among `consensus`, `majority`, `evidence-based`, and `no-consensus`, with `CONSENSUS:`, `UNRESOLVED:`, and `MINORITY-EVIDENCE:` lines. `DebateResult` carries `verdictMode`, `consensus` (true only for `consensus`), `unresolved`, `minorityEvidence`, `moderator`, and `moderatorHarness`. A synthesis without a `VERDICT:` line falls back to its legacy `CONSENSUS:` line. The parser strips the markdown a chat model wraps its answer in — block and list markers, emphasis around the label, and emphasis around the value — before it reads a field, and a reported value that says nothing was reported (`none`, `n/a`, `no unresolved disagreements`) is dropped instead of published. The debate is read-only toward the project; applying a recommendation needs explicit user authorization.

The Evidence Review prompt requires each seat to cite code, tests, or references for and against the claims, and states that a claim without evidence stays a claim. The moderator instructions require a `MINORITY-EVIDENCE:` line whenever a minority claim carries supporting evidence, including when the verdict is `majority`.

## Alternatives considered

**Clone the debate-review JSON contracts verbatim:** the `findings.v1` / `debate.v1` / `final.v1` documents of `amElnagdy/review-skills` are rejected in this form because they anchor every finding to a forge diff (`file`, `line_start`, `line_end`) and post inline comments, which narrows a generic problem debate to PR review. What is adopted is the underlying discipline — an evidence bar for refutation, distinct voices for challenge and final call, and a strict line contract the orchestrator parses — without the forge anchoring.

**Fork a new debate seam beside the roster and mailbox:** rejected because `DebatePorts` (`spawn`, `send`, `collect`, `dispose`) already reaches `spawnTeammate`, the durable mailbox, and persisted Session surfaces through `TeamService.conductDebate`, and a parallel interface would duplicate capability advertisement, cancellation, and structured-result contracts. The moderator travels through the same ports, so identity, delivery, and teardown stay unified.

**Treat a majority verdict as consensus:** rejected because three agreeing seats can still certify a false claim. The majority mode reports the larger side without certifying it, the evidence-based mode lets the strongest evidence win from the minority, and `MINORITY-EVIDENCE:` lines survive beside either verdict in the published result.

**Copy the reference skills in place:** rejected per the Phase 8 mission note, where copying skills in place is not completion. The adopted patterns below are re-implemented against the `SubagentProvider` seam and the Team mailbox, not imported as files.

## Consequences

The debate publishes an independent verdict with objections, evidence, responses, consensus versus unresolved disagreements, and minority evidence in one result, at the cost of one extra evidence round per multi-round debate and one dedicated moderator seat per debate.

Reference patterns from `amElnagdy/delegate-skills` and `amElnagdy/review-skills` (fetched for this change) shape the design: lanes bind an implementer plus optional model and effort dials with explicit approval and loud refusal, which maps to seats binding a provider plus speaking name with pre-spawn validation; the debate-review skill runs a main reviewer, a distinct debate reviewer that must carry evidence to refute, and a main-reviewer final call with agreed, contested, and withdrawn outcomes, which maps to the dedicated moderator, the Evidence Review phase, and the four verdict modes; and the debate-review skill runs read-only and never approves, which maps to the read-only debate default. The moderator defaults to the in-harness `spawn` connection so a simple debate does not summon an expensive external Harness for moderation, while callers choose a different Harness explicitly through the moderator parameter.

Scripted-port tests in `packages/subagent/agent-team/tests/debate.spec.ts` remain the orchestration evidence: they pin phase order, per-turn identity, the dedicated moderator, all four verdict modes including the minority-evidence and evidence-based cases, the legacy fallback, a markdown-wrapped verdict with placeholder reports, and the pre-spawn refusals. Live collection stays covered by the `conductDebate` wiring, unchanged from the collection contract above.

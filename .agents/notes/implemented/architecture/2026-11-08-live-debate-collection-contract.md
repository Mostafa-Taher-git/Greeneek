# Agent Note: Live debate collection

Status: implemented

## Problem

`runDebate` (`packages/subagent/agent-team/src/debate.ts`) orchestrates rounds against the `spawn`, `send`, `collect`, and `dispose` ports, but no `conductDebate` host wiring exists, so the four scripted-port tests prove round management, identity preservation, and verdict parsing without any inference.

## Decision

`TeamService.conductDebate` (`packages/subagent/agent-team/src/index.ts`) wires the `runDebate` ports to the roster, durable mailbox, and persisted child Sessions, with `spawn` delegating to `spawnTeammate`, `send` to `sendMessage`, `dispose` to roster teardown, and `collect` reading the child's own persisted Session surface.

Collection is turn-scoped, not reply-count-scoped. Each `spawn` or `send` records the persisted log length immediately before it queues the prompt, and collection accepts only the first `turn/start` at or after `max(recorded boundary, inheritedEventCount)`. That turn's own `turn/end` must exist before its `assistant/message` text is returned, so neither an inherited fork prefix nor a reply that settled before collection began can answer the current prompt.

A turn that ends without text fails named: `TEAM_DEBATE_EMPTY_TURN` for a turn that produced nothing and `TEAM_DEBATE_MEMBER_FAILED` when the turn produced text but ended in error or abort. The failure text names the terminal stop condition, including the output-token ceiling. A lane idle with no new turn fails `TEAM_DEBATE_EMPTY_TURN` after 100 idle polls, and a settled one-shot seat returns its journal `result.output` before that refusal.

The multi-round gate resolves the `greeneek` Harness alias through `HarnessRegistry.resolveConnection` before checking continuable providers, and pre-validates distinct speaking names and registered providers before any seat spawns. `conductDebate` additionally refuses, before the first seat exists, a duplicate participant name, a moderator name colliding with a participant, a name already used by a roster teammate (`TEAM_MEMBER_NAME_TAKEN`), and a debate whose participant-plus-moderator seats would exceed `maxMembers` (`TEAM_MEMBER_LIMIT`). The roster is append-only, so repeated debates need distinct speaking names and free seats.

`gnk-tool-agent-team` exposes the result as the Lead-only `conduct_debate` model tool; multi-round seats must hold a continuable lane, and one-shot adapters remain position-only.

## Alternatives considered

**Fresh-session-per-round transcript threading for one-shot externals:** rejected because a new child per round loses participant identity and durable lane state, which the debate contract requires to preserve, so external adapters stay position-only until they offer continuable session threading.

**Bare polling without a turn boundary:** rejected because `whenIdle`-only collection races the idle-before-start case where a fresh child reports idle before the round message lands, so collection pairs the pre-request log length with a running-status poll.

**Counting assistant messages instead of binding to a turn:** rejected after a live run returned the parent's `READY-LIVE` text as the moderator's synthesis. A fork child inherits the parent's assistant prefix, so a reply-count watermark accepts inherited messages, and a seat whose reply settled between `send` and `collect` was dropped for producing no new count.

**Service-only without a model tool:** rejected because a debate the model cannot invoke is unreachable in practice; the Lead-only `conduct_debate` tool makes the same service path reachable under `exec.signal`.

## Consequences

Debate rounds are genuine multi-Harness turns over durable lanes at the cost of one persisted-Session read per poll pass and one dedicated synthesizer seat per debate. A Team roster is append-only, so each session supports a bounded number of debates before `maxMembers` is consumed.

External-CLI adapters stay one-shot, so multi-Harness multi-round debate remains impossible for them until continuable adapters land, and every seat is torn down through roster teardown when the debate ends or aborts.

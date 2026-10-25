# Agent Note: Army wave lifecycle lands as three log-only wave/* Session events

Status: implemented

## Problem

The Army wave engine kept every fleet detail process-local: a session log replay could not show which waves a Lead admitted, which members settled with which terminal status, or how budgets were consumed, because no wave event existed in `SessionEventMap`. The engine README carried "No durable wave record yet" as a known limitation, and the wave-engine Agent Note deferred this piece until the Army UI wave could consume it.

## Decision

The engine writes three log-only records onto the Lead agent's session, appended directly at the existing write points instead of through a separate notifier: [`wave/initiated`](../../../../docs/persistence-catalog.md) at admission — identity, resolved completion policy, budget ceilings when set, and memberships in dispatch order — written before the wave enters the runtime's retained map, so admission is all-or-nothing with its record; `wave/member-settled` at the single settlement funnel, exactly once per member through an idempotence guard set only after the write commits, so a failed append stays re-attemptable; and `wave/settled` when the wave closes, carrying the outcome plus every member's terminal row in dispatch order. `closeWave` writes any straggler member record itself, and a member funnel arriving after the close writes nothing, so the closing record is always the last `wave/*` record its wave id receives. Payloads are inline object types merged through `@greeneek/gnk-session/types` per the `subagent/descriptor` precedent; same-repo readers admit them through the regenerated known-type set.

## Alternatives considered

**Stamping first-party envelopes with the `ignorable` marker.** Rejected: `Session.append` freezes the envelope without a marker parameter, and the 2026-08-30 mechanism note reserves `ignorable` for out-of-repo events whose types same-repo readers must not interpret; membership in the regenerated `KNOWN_SESSION_EVENT_TYPES` is the first-party admission mechanism, so no parallel path was minted.

**Recording every lifecycle transition per member.** Rejected: intermediate queued/running records would duplicate what the fleet view polls from the remote faces and break the exactly-once terminal guarantee; one settlement record per member keeps replay cheap.

**Forwarding the events over the remote-event allowlist now.** Deferred to the fleet UI wave: forwarding needs a host-side Cordis emitter plus one `remote-events.ts` entry; minting that wire schema with no consumer yet manufactures dead surface.

## Consequences

- Session logs now replay an Army Lead's fleet history: admission policy with resolved values, per-member terminal statuses with metered tokens and diagnostics, and the closing outcome with dispatch-order rows.
- Member settlement records join the log in settlement-completion order — `memberIndex` is the stable join key back to dispatch order — and the subsystem page's new reader section states the three ordering guarantees verbatim.
- The persistence catalog and known-type set regenerate with the three log-only types; the wave README limitation bullet is replaced with the durable-records, process-local-control statement.
- The fleet UI keeps polling the remote faces; deriving its display from the log remains out of scope.
- Tests pin the full-scope log shape (clean wave, straggler, cancel diagnostics, fail-fast policy), and per-file coverage stays at 100% (291 statements / 199 branches / 55 functions / 252 lines).

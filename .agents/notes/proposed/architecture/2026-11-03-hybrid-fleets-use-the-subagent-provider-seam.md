# Agent Note: Fleets hold native agents and external CLI agents through one execution seam

Status: proposed

## Problem

Maestro must orchestrate both native Greeneek modes and external CLI coding agents, and the owner authorized that hybrid shape explicitly on 2026-11-03: one fleet may mix in-harness agents with CLI agents, `SpawnTeammateRequest` must not be forced onto CLI agents, and native modes must not be dressed up as external processes. Today the fleet layer forbids the mix in two places that are visible in the shipped source.

`packages/subagent/agent-team/src/fleet-config.ts:20` sets `DEFAULT_FLEET_PROVIDERS = ['spawn', 'fork']` and refuses any other member provider with the text "outside this deployment's in-process fleet providers" (`fleet-config.ts:197-202`) — a family rule written inside the fleet layer, while provider names are themselves deployment-configured through `config.providerName` (defaults such as `claude-code` in `packages/subagent/subagent-claude-code/src/index.ts:33`), so the fleet must never match a name literally.

The deeper rule is measured, not inferred: a Team lane requires a **continuable** child. `TeamRoster.spawn` is documented and built as "one named, continuable direct child of the Team Lead" (`packages/subagent/agent-team/src/roster.ts:242,247`), and session recovery re-activates a member only when its folded descriptor reads `mode === 'continuable'` (`roster.ts:558`). `packages/subagent/agent-team/tests/fleet-settings.spec.ts:27` records the consequence: a CLI provider is reported `state: 'unsupported-version', continuable: false`.

## Proposal

Keep one execution seam and make fleet eligibility a capability question rather than a family question.

The unified Agent Execution interface is the existing `SubagentProvider` seam (`docs/subsystems/subagent.md` §"The provider contract: `SubagentProvider`", `packages/subagent/subagent/src/types.ts`; registration through `ctx.subagents.registerProvider()` at `packages/subagent/subagent/src/index.ts:511`). It already normalizes capability advertisement, availability, request validation, execution lifecycle, progress, cancellation, and structured results, and it already refuses a request that needs a capability the provider lacks with `SubagentError('UNSUPPORTED_CAPABILITY')` instead of accepting and ignoring it. Fleet code reaches it through `ctx.subagents.list()` / `getProvider(name)` and the roster.

Two adapter families, distinguished by descriptor presence and not by a new type tag: a provider whose descriptor carries `prepareContinuable` holds a durable Team lane, which is exactly how `packages/subagent/agent-team/src/index.ts:502-504` already derives the `continuable` set. In-process providers (`spawn`, `fork`, SDK, in-process driver) and external CLI providers (`claude-code`, `codex`, ACP) are then eligible on the same terms, each keeping its own composition path.

Admission becomes derived: omitting `Config.fleetProviders` means "every registered provider this surface can lane", while an explicit non-empty list narrows it, and the existing loud refusal for an empty list stays. Availability reporting and validation read the same derivation so Settings cannot offer a row the launcher would reject.

Mixed fleets additionally need a one-shot member mode in the roster, the projection and the result contract, so a provider without `prepareContinuable` can be a fleet member that runs to completion and returns a structured result. Mailbox and follow-up stay refused for such a member — reported, never silently dropped. Tracked as plan items S8-03c and S8-03d.

## Alternatives considered

- Add a new `AgentExecution` interface above `SubagentProvider`. Rejected: it would duplicate capability advertisement, cancellation and result shapes that already exist, then need its own consistency test against the seam it wrapped, and it hides the families that are already visible in the registry.
- Widen `fleetProviderAvailability` to report a registered non-continuable provider as `ready` now. Rejected: with `roster.ts` accepting only continuable children, that converts a pre-flight refusal into a launch-time failure — the false green this repository's rules forbid.
- Keep the native-only allowlist and add per-family branches in the fleet code. Rejected: the fleet layer would then name deployment-configured providers literally and re-implement the capability check the SPI already performs.

## Risks

Widening admission lets a fleet name a provider whose CLI is absent. Mitigation: availability rows come from the live registry and launch re-asserts readiness without substituting another provider (`assertFavoriteProviderReady`, `fleet-settings.ts:263-273`); repository fleet files keep their byte cap, strict schema and one-time approval keyed to exact bytes (`fleet-config.ts:97-176`).

A one-shot member mode touches durable-session recovery. Mitigation: recovery re-activates a member only when its persisted descriptor reads `mode === 'continuable'`, which a one-shot run never writes, so an unfinished one-shot member settles `failed` instead of being silently re-activated as a lane.

Fleet storage gains scheduler-shaped fields (enabled, priority, concurrency, per-member timeout, default fleet, per-project defaults). Mitigation: each field lands only with the code that enforces it plus a test, because a stored-but-unenforced timeout is the silent ignoring this decision rejects.

## Acceptance criteria

- A repository fleet and a stored favorite can each contain a native in-harness member and an external CLI member in the same fleet, and both launch through their own provider paths.
- `RepoFleetConfigStore` refuses an unregistered provider and a provider that cannot hold the lane the member requests, naming the provider and the reason; no refusal text claims in-process-only.
- No fleet source file matches a provider name literally; the admitted set comes from the registry, and an explicit `fleetProviders` list still narrows it.
- A member whose provider lacks `prepareContinuable` runs to completion, reports a structured result, and any follow-up or mailbox request on it is refused with a named reason.
- Every new fleet settings field has an enforcing implementation and a test; migration tests prove stored favorites without the new fields still read, validate, and launch.
- S8-16a's cases exist and pass, and a mixed fleet is exercised in `gnk web` dev mode with the evidence recorded in the plan's Execution ledger.

## Verification

**Part of this decision is now implemented and measured.** The roster admits a provider without `prepareContinuable` as a `one-shot` member: dispatch is selected from the registered capability, one `active -> completed` durable edge carries `stopReason`, `output` and `diagnostic`, `timeoutMs` aborts the member's own budget controller through the composed start signal, mailbox and interrupt refusals return `TEAM_MEMBER_NOT_INTERACTIVE`, a failing sibling keeps its own row, disposal runs once across success, timeout and cancellation, recovery ends an unfinished one-shot member as `failed`, and the projection permits `completed` only for one-shot rows. Evidence: `packages/subagent/agent-team/tests/team.spec.ts` → `One-shot members`, `tests/projection-events.spec.ts` → `permits the completed edge only for a one-shot member`, and `vitest run packages/subagent/agent-team` → 178 passed / 1 skipped with 100% on lines, functions, branches and statements for `roster.ts`, `projection.ts`, `types.ts`, `fleet-settings.ts`, `integration.ts`, and `lane-support.ts`.

**The implementation corrected two points of this proposal.** A one-shot member needs no `lane-lifecycle.ts` change and no new descriptor value: an isolated write scope needs the durable lane that a one-shot run does not have, so a one-shot spawn with `writeScopes` is refused with `TEAM_INVALID_LANE_POLICY`, and `timeoutMs` on a continuable spawn is refused with `TEAM_INVALID_ARGUMENT` because a lane is stopped by interrupting it. Fleet admission derivation shipped separately as S8-03d.

**Still unimplemented, and not claimed.** Fleet launch still requires a continuable provider — `fleetProviderAvailability` reports a registered non-continuable provider as `unsupported-version` — so a mixed repository fleet or stored favorite cannot yet start a one-shot member. No shipped profile mounts an external CLI adapter, so no mixed fleet has been run in `gnk web`. A settled one-shot result is durable on the member row but is not yet delivered to the Lead's model or shown in a roster row. Every factual claim above that is not labelled as measured is read from the cited shipped source.

## Related

- [v0.3.9 master release plan](../process/2026-11-01-v0.3.9-master-release-plan.md)
- [Agent Teams in the Web client](../../implemented/feature/2026-08-06-agent-teams-web.md)

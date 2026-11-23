# Agent Note: Deep-agent — independent proactive agent subsystem

Status: proposed

## Problem

The owner requires a faithful Greeneek adaptation of the reference superagent prototype: an independent "Deep-agent" subsystem with its own Router session, Worker sessions, domain model, SQLite persistence, event engine, durable effects, GitHub/Feishu sources, management panel, and configuration. It must not become a Maestro redesign, a Fleet enhancement, a Mode, a generic multi-agent framework, or a UI clone.

Reference baseline: `https://github.com/deepseek-ai/dsh-superagent-prototype`, cloned for study under `%TEMP%/dsh-superagent-prototype`. rebrand:keep — provenance URL and original copyright owner, required by the reference MIT license. The repository is an MIT-licensed research prototype, © 2026 DeepSeek Harness Team (`LICENSE:1-21`), described in its own `README.md:3-5` as reference material adapted for publication, not an official product. The linked X article is login-gated and contributes no implementation facts; the repository is the sole baseline.

## Proposal

Implement Deep-agent as a new `packages/deep-agent/` group with independent core, store, effects, policy, sources, and runtime packages, plus a standalone Web page. Preserve the reference domain, pipeline, and operational contracts; adapt only host-specific glue to Greeneek services. The detailed inventories and plan follow.

### Architecture inventory (Greeneek)

Greeneek is an all-plugin Cordis harness. A new Host capability package lives at `packages/<group>/<pkg>/`, is named `@greeneek/gnk-<name>`, declares `@greeneek/cordis` as peer plus dev dependency, default-exports a service class (function plugins named-export `name`/`inject`/`Config`/`apply` with no default), and registers in `tsconfig.host.json` plus a bundle patch layer (`AGENTS.md:103-112`; `packages/AGENTS.md:5-6`; `docs/cookbook/adding-a-package.md:6-37`).

Model-facing infrastructure is the six-package core spine: `session`, `system-prompt`, `tools`, `agent`, `agent-loop`, `scope` (`docs/subsystems/core.md:10-23`). Work is driven through `ctx.agents.create()` returning an `AgentHandle` whose `dispose()` is the ownership token; turns use `agent.followup()`, `steer()`, and `inject()` (`core.md:25-145`). Anything reaching a model request must be reconstructable from the Session log; a new model-visible input requires a `SessionEventMap` entry (`AGENTS.md:110`). Role-specific tools, prompts, and listeners are scoped through each agent's `setup`/`agent.ctx`, so Router and Worker boundaries need no loop change.

Persistence offers two distinct mechanisms. `ctx.storageDomain` with `defineDomain()` provides versioned KV tables with fail-loud version rejection, per-write atomicity, and no cross-table transactions (`docs/subsystems/storage.md:46-152`). A dedicated SQLite file with `PRAGMA user_version`, owner-only creation, stamp-last initialization, and `SCHEMA_VERSION` is the established pattern for an authoritative independent store (`packages/storage/storage-sqlite/src/schema.ts:14-107`). The derived, reset-in-place session-query database is unsuitable for Deep-agent domain facts. Process locking uses `withFileLock` (`packages/util/atomic-write/src/index.ts:157`) and the reference uses `proper-lockfile` against its state directory; either is acceptable if single-writer ownership is enforced.

Subagent, Maestro, and Fleet are separate product surfaces with their own keys: `ctx.subagents`, `ctx.waves`, `ctx.agentTeams` (`docs/subsystems/subagent.md:4-40`; `packages/subagent/README.md:22-40`). Active proposed notes reject a parallel agent-execution seam: external Harnesses must extend `SubagentProvider` (`2026-11-03-hybrid-fleets-use-the-subagent-provider-seam.md`), and Maestro is the central authority for Harness orchestration (`2026-11-06-harness-is-the-unit-of-agent-execution.md`). Deep-agent therefore must not implement a second generic Harness/agent-execution registry, must not register a `SubagentProvider`, and must not touch Fleet or Maestro. Its Router/Workers are its own domain-owned executors built directly on `ctx.agents` and `ctx.llm`.

Credentials are resolved per operation through `ctx.credentials.resolve(ref)` and never cached; values must never cross a Remote boundary (`docs/subsystems/credentials.md:8-19,180-215`). `GithubController` is the exact precedent: host-side fetch, `redirect:'error'`, bounded output, `status()` returning only `{configured,pageLimit}`, and a test seam in a `WeakMap<Context,...>` (`packages/api/workspace-controller/src/github.ts:20-28,78-96,411-433`).

The Web client composes UI only through `ctx.slots.register`/`slots.inject`; a standalone main-column page needs a `mainPage` union member, a layout-store action, an `ILayout` method, a root slot declaration, and an `AppFrame` render block (`ui-layout/src/client/stores.ts:33,43-67,88-154`; `service.ts:23-68`; `index.ts:37-122,212-229`; `AppFrame.tsx:26,310-342`). Page state that must survive navigation belongs in a store created at registration, never a module-level singleton (`packages/client/AGENTS.md:16`). All product copy is locale-owned in typed zh/en/ar dictionaries (`verify-client-ui-i18n`).

## Reference-to-Greeneek mapping

The reference core is host-independent TypeScript and is the highest-value port: `src/core/{model,ports,ids,reasons,errors,stage}.ts` plus the five engine parts and `engine.ts` import nothing outside the domain except `node:crypto` (`docs/007-architecture.md:258`). These map to a new `packages/deep-agent/core` package with no Cordis dependency beyond types.

`src/app/store.ts`, `store-read.ts`, `migration.ts`, `versions.ts`, `cache.ts` map to `packages/deep-agent/store`: a dedicated SQLite database with its own schema version, a write-side `Repositories` port, and a separate read-query surface. The reference's `Store.atomic` SAVEPOINT with nested rollback and `afterCommit` callbacks maps directly onto `node:sqlite` transactions.

`src/app/effects.ts`, `outbox.ts`, `passes.ts` map to `packages/deep-agent/effects`: durable effect kinds `assessment`, `launch`, `delivery`, `relay`, `notice`, `reply`, deterministic ids, `INSERT ... ON CONFLICT DO UPDATE` coalescing, bounded exponential backoff, ordered kinds, and outbox receipts with per-Ticket ordering.

`src/app/sessions.ts`, `assessment.ts`, `prompts.ts`, `context.ts`, `execution-environment.ts`, `role-models.ts`, `delivery.ts`, `notices.ts`, `cards.ts`, `links.ts`, `resources.ts` and `src/executor/{dsh,background}.ts` map to `packages/deep-agent/runtime`. rebrand:keep — literal reference source filename. The mapping is re-targeted from the competing host's agent/session/subagent APIs onto `ctx.agents`, `ctx.sessions`, `ctx.llm`, `ctx.tools`, `ctx.systemPrompt`, `ctx.skills`, `ctx.credentials`, and `ctx.subprocess` where genuinely needed. `WorkerSlots`, failure classification, recovery notes, and the no-wait guard are preserved.

`src/sources/*` map to a three-role capability seam: `packages/deep-agent/sources` owns the `SourceKind` Service Definition and registry; `sources-github` and `sources-feishu` are Providers; `runtime` is the Consumer. `SourceKind`, trigger translation, read cursors, thread correlation, channel addressing, health, and idempotent send markers are preserved; CLI details are adapted to Greeneek subprocess plus credentials.

`src/policy.ts`, `admission.ts`, `limits.ts`, `kv.ts`, `setup.ts`, `deployment.ts` map to `packages/deep-agent/policy` and a config block in the runtime package. Policy version = `key('mandate-v3', rules + mode + sources)`; admission cells, accept modes `off`/`observe`/`auto`, gate, revalidation, and `policyEffects` are preserved exactly.

`src/app/http.ts`, `api.ts`, `views/*` and `src/client/*` map to a Host `TypertRemoteService` namespace `deepAgent` plus a new `packages/client/ui-deep-agent` standalone page. The reference panel's six tabs map to Overview, Sources, Triggers, Evals, Execution, and Settings inside that page, with real Remote-backed actions only.

`prompts/*.md` and `skills/*/SKILL.md` are ported as text with the reference product prefix renamed to `gnk-deep-agent-*`; the MIT notice and research-prototype provenance are carried in the new group README.

## Domain model mapping

All fourteen entities are preserved with their original names and fields. Source is a kind/instance pair owning read position and bot identity. Trigger is an immutable event with `id`, `source`, `threads`, `actor`, `human`, optional `addressed`, `at`, `text`, `channel`, `url`, `meta`, and a `TriggerDisposition`. Thread owns `subscriptions`, `context`, `correlated`, `pending`, at most one `evaluating`, and `expired`. Eval carries `triggerIds`, `strength`, `actor`, `basis`, `policyVersion`, `delivered`, and `deadline`. Decision kinds are `ignore`, `accept`, `reopen` (legacy), `stop`, `unavailable`, with `Reason[]` audit. Ticket owns `mandate`, `channels`, `inputs`, `assignments`, `undelivered`, `follows`, optional `attention` and `ended`, with stages `person/{delivery,answer,review,blocked,failed}`, `working[/queued]`, `idle`, `ended`. Mandate is immutable with strength `explicit`/`inferred` and `via` one of `addressed`, `followup`, `admission`, `listed`, `bot`. Assignment state is `pending → running → ended`. Subscription fan-out grants no new authority; a human-stopped Ticket receives nothing. Channel is the write side with `OutboundMessage` kinds `acknowledgement`, `reply`, `notice` and receipt statuses `pending`, `sent`, `dropped`. Policy is versioned with gate and revalidate. Input is the tagged union `trigger`, `policy-changed`, `reopen`, `resumed`, `text`, `note`. Report states are `progress`, `waiting`, `ready`, `blocked`, `failed`, `dropped`.

The pipeline is Source → Trigger → Thread → Eval → Decision → Ticket → Assignment → Executor → Report/Channel. Fast paths (subscription fan-out, resumed Ticket, worker-owned follow-up) bypass Eval and grant no authority. Slow path batches pending Triggers per Thread, picks the strongest admissible Trigger, runs gate and assessor, and decides. Deterministic ids come from `key(...values)` — the first 32 hex of `sha256(JSON.stringify(values))` — and make duplicate delivery idempotent.

## Dependency graph and package boundaries

`core` has no Greeneek dependencies. `policy`, `store`, and `effects` depend only on `core`. `sources` depends on `core` and `policy`. `sources-github` and `sources-feishu` depend on `sources`, `core`, and Greeneek credentials/subprocess adapters. `runtime` depends on all of the above plus the Greeneek spine (`agents`, `sessions`, `llm`, `tools`, `system-prompt`, `skills`, `credentials`). The client package depends only on generated Remote types and shared Client infrastructure. No package imports Maestro, Fleet, subagent, or wave packages.

## Migration strategy

A new Deep-agent database starts at `SCHEMA_VERSION = 1` with no legacy migration path. The reference's version 10→11 rewrite is deliberately not ported: Greeneek ships no Deep-agent data. A newer on-disk version is refused, an older one is refused with an explicit `tooOld` error, and fresh initialization stamps `user_version` last so a partial failure leaves the file unstamped. Ported prompt and settings versions start at revision 1 with the same immutability rule.

## Risk assessment

The largest risk is accidental coupling to Maestro/Fleet through convenience reuse of `ctx.subagents`; the boundary above forbids it. The second is model-visible facts stored only in the Deep-agent DB; the boundary requires any fact entering a model request to be emitted as a Session event and rendered from the log. The third is worker concurrency theatre; real slots, real agents, real cancellation, and real reports are required, with no fabricated progress. The fourth is source credentials; all tokens stay host-side and are resolved per operation. The fifth is scope: the reference is roughly 16k lines of source plus 60 specs, so delivery must be incremental and each phase independently verifiable.

## Test strategy

Port the core specs first against in-memory repositories: `core-engine.spec.ts`, `stage.spec.ts`, `policy.spec.ts`, `model-surface.spec.ts`. Add store specs for schema version refusal, atomic rollback, and restart recovery. Add effects specs for idempotent enqueue, backoff, ordering, and duplicate outbound prevention. Add source specs with scripted HTTP for GitHub trigger ids, cursors, bot filtering, thread correlation, and idempotent send. Add runtime specs for Router continuity, Worker slot capacity, interruption recovery, report states, and stop/retry. Add a REAL-composition Host test booting a test-only profile through Loader. Add client registration, component, and disposal specs, plus `verify-client-ui-i18n` and the recorded-session snapshot path for user-visible changes.

## Ordered implementation plan

Phase 1 foundation: create `packages/deep-agent/core`, `store`, `effects`, and `policy` with domain types, deterministic ids, engine, SQLite schema/locking/repositories, durable effects, outbox, and policy; verify with ported core and store specs.

Phase 2 sessions and execution: create `runtime` with Router/Worker session ownership through `ctx.agents`, role prompts, worker slots, assignment launch/delivery/report, cancellation, retry, and restart recovery; verify real parallel execution.

Phase 3 event engine: wire ingestion, thread correlation, eval deadlines, fast path, admission decisions, ticket creation, subscriptions, follow-up routing, effects, and outbox; verify idempotency and restart.

Phase 4 sources: implement the `sources` seam plus GitHub and optional Feishu providers with credentials, polling, cursors, health, and durable outbound replies; verify with scripted transports.

Phase 5 panel: create `packages/client/ui-deep-agent` with the six real tabs, status indicators, timelines, and human-action controls using Greeneek tokens and locale dictionaries.

Phase 6 integration: mount the Host Remote in `api-remotes`, add the sidebar row in the required order (New Session, Plugins, Automation tasks, Deep-agent, Workspaces), add the standalone `deep-agent` layout page, and compose the bundle.

Phase 7 hardening: run typecheck, lint, focused and full unit tests, GUI tests, generated-artifact verification, and production build; fix only failures introduced by this work.

### Implementation checklist (2026-11-23)

Done and verified: Phase 0 reconnaissance and plan (`34f9f7b0`); `core` with the 14-entity domain, deterministic ids, stage classification, in-memory repositories, and the transactional Event → Trigger → Thread → Eval → Decision → Ticket → Assignment pipeline (`ece1e00f`, 13 tests); `store` with versioned SQLite schema, owner-only creation, SAVEPOINT transactions, effects, outbox receipts, and restart recovery (`592d71b5`, 8 tests); `effects` with the six durable kinds, coalescing, backoff, `Later` deferral, ordering, and restart recovery (`5d23f552`, 6 tests); `policy` with the admission matrix, version hash, gate, revalidation, and direction validation (`96d5bd27`, 10 tests); `runtime` with the Host service, store/engine/effects/policy ownership, management Remotes, and the `deep-agent/changed` event (`cec2b5ce`, 5 tests); client `ui-deep-agent` with the permanent sidebar entry and standalone Overview/Tickets/Decisions/Triggers page backed by real Host state (`6f42aed3`). Live Web and Desktop verification confirms the required sidebar order New Session, Plugins, Automation tasks, Deep-agent, Workspaces, plus collapsed-rail parity and real page data.

Added after the first handoff: real Worker sessions through `ctx.agents` with slot reservation, isolated working directories, mandate prompts, scoped `deep_agent_report` tools, input delivery, cancellation, deterministic Worker session ids, and restart recovery (`ba8d0b9d`, 7 unit tests); persistent Router session with a durable session id, resume-on-boot, scoped `deep_agent_decide` tool, candidate cards, and a real assessor effect path (`85bf9ff5`, 2 unit tests). A Host-boot regression caused by registering the executor library as a plugin was fixed in `518898d9`; live Web verification confirms boot, sidebar order and the Deep-agent page with no console errors.

Still pending: GitHub and Feishu source adapters with credentials, cursors, health, and idempotent outbound delivery; settings and prompt/version management in the panel; REAL-composition Host test and recorded-session snapshot coverage; production build hardening; and a live end-to-end workflow driving a Trigger through Router assessment into a running Worker. The `reply` effect handler remains a Source-side placeholder; `assessment` and `notice` are now real Router paths.

## Acceptance criteria

A user can open Deep-agent from the sidebar and see real state from the Host. The Router session persists its id across restarts and continues coordination. Multiple Workers execute concurrently under a real slot limit with isolated sessions and working directories. Tickets, Assignments, effects, and outbox receipts survive restart. Duplicate events do not create duplicate Tickets. Mandates constrain execution and context inputs grant no authority. Subscriptions deliver follow-ups without re-admission. Retry, stop, and interruption recovery work against real agents. GitHub events initiate work through a real adapter; Feishu is configurable as an optional source. The panel shows real operational state with no decorative controls. Existing Maestro, Fleet, modes, and subagent behavior is unchanged. Critical tests and the production build pass.

## Risks

Scope is large enough that intermediate commits will be honest phases rather than a single completed system; each phase must state what is verified and what remains. The reference depends on a competing harness's CLI and agent APIs, so some executor and source glue is a reimplementation rather than a literal port. The reference prototype is explicitly not production-ready, so its security and concurrency boundaries are reviewed rather than copied blindly. Windows-only host constraints mean recorded-session fixtures cannot be re-recorded locally.

## Alternatives considered

Making Deep-agent a Maestro Mode was rejected because the owner requires an independent subsystem. Reusing `ctx.subagents` or `ctx.waves` as its engine was rejected because active architecture notes reserve those seams for Fleet/Harness orchestration and forbid a parallel execution registry. Reusing the session-query SQLite database was rejected because it is derived and reset-in-place; Deep-agent needs authoritative data. Building a generic multi-agent framework was rejected because the reference domain is the baseline.

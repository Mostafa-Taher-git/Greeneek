# AGENTS.md

Greeneek is all-plugin Cordis harness. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for docs.

## Pre-release stance: foundation over blast radius

**Remove at first tagged release.** Until then, prefer correct foundations to shims: rename or repackage freely and update references. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `gnk-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

**Application launch.** Only `gnk` profiles launch Node apps; package bins, demos, and public SDK argv escapes are forbidden ([rule](docs/architecture.md#application-launch)).

## Repository layout

```
vendor/      Vendored Cordis source — manifest + sync procedure in vendor/README.md
packages/    @greeneek/gnk-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and Typert RPC gateway
  typert/      type graph generator, loader, and runtime registry
  llm/         LLM capability: Service Definition/Consumer + Greeneek providers
  e2b/         E2B POC: sandbox + FS/subprocess adapters
  shell/        bash capability: Service Definition + local/pwsh providers + shell Consumers
  subprocess/  subprocess capability + local process-tree provider + shared Win32 library
  terminal/         persistent sessions
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compaction/     compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable gnk --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  webhook/     webhook ingress
  todo/        todo_write tool
  plan/        plan mode as logged state
  preset/      per-session agent composition from preset cordis.yml files
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  identity/    anonymous identity
  settings/    user-settings capability + file provider
  credentials/ credential/authorization capabilities + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared profile/application boot glue
  sdk/         JSON-RPC protocol + TypeScript client/server
  experimental/ private prototypes excluded from official releases
  support/     dev/test infrastructure
  util/        zero-dependency utilities
python/      Python SDK and bundled runtime (see python/README.md)
native/      @greeneek/node-addon-landlock-run source of record (see native/README.md)
.agents/     Agent workflows and Agent Notes (`notes/`)
docs/        architecture, generated catalogs, postmortems, cookbook (see docs/AGENTS.md)
scripts/     repo gates and generators
website/     VitePress projection of selected docs/ sources
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run test           # unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without their lane's key (GREENEEK_API_KEY for the Greeneek endpoint)
pnpm run test:expected  # owner-local process expectations
pnpm run test:snapshot  # keyless recorded-session replay through shipped profiles; filter: -t <name>
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # publint + workspace/package/dependency checks + NodeNext consumer check
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run test:docs      # quick documentation checks (no build; doc-quick aggregate)
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm gnk --profile headless "task"  # run one task from source (needs a provider key from Settings; GREENEEK_API_KEY is one provider's key)
pnpm run demo:ptc -- "task"  # headless PTC mode run (needs key)
```

### Host sandbox failures

If required `gh`, `pnpm`, build, test, or generator command fails because sandbox blocks credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with narrowest host escalation. Require sandbox evidence; never bypass test failures or product sandbox.

### Run relevant checks locally

Run checks before pushes via [gnk-pre-push-checks](.agents/skills/gnk-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate; do not merge before checks pass.

- Match evidence to surface: behavior tests, model/user-output snapshots, `doc-sync` for docs, built smokes for published paths, real-API e2e for providers.
- Never default to full suite or repeat passing check for commit/push. CI owns exhaustive coverage and platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or irreducibly repository-wide change.
- `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)).

## Secrets / .env

Real-API tests/demos read lane provider key. Greeneek-endpoint lanes read `GREENEEK_API_KEY`, optional `GREENEEK_BASE_URL`, and root `.env`. Greeneek starts and non-AI features run without key. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Every npm package is `@greeneek/gnk-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)) and `private: true`. `@greeneek/cordis` is peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` locally. Config subprocesses run built `lib/` under plain Node; source regressions use declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). `gnk` CLI source launch runs via tsx's ESM-only hook (`node --import tsx/esm`); reached modules must stay ESM (no CJS-only exports) — Node native TypeScript modes are unavailable across engines range ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-gnk-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in resolver manifest `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: contributions go through `ctx.effect()` / `ctx.on()`; registry's `register()` returns disposer.
- **Runtime invariants assert owned relationships.** Publish `./invariant` only when independent observations can diverge. Otherwise omit source and wiring and record why in README; empty installers and checks of service presence, plugin metadata, effects, fixed examples are invalid ([package invariant rules](packages/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@gnkScopeScan unsupported`. Public service methods document parameters, non-void returns. `SessionEventMap` members are required-on-read by default — builds that do not know a type refuse log unless event carries envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything reaching model request must be reconstructable from session log; new model-visible input requires session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **Capability seam comprises Service Definition / Service Provider / Consumer roles.** Complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when genuinely delete owned code, tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Reference-driven, cross-platform fixes**: significant defects get root cause, study of four references ([plan](.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md#permanent-engineering-principles-all-releases-from-the-2026-11-08-owner-amendment)), reuse ledger, Windows/Linux validation.
- **Explicit > implicit at package boundaries**: defaulting is explicit `resolve(request): Spec` step in owning implementation, never hidden `?? default` inside `run()` (`gnk-shell` request/spec split template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; `DEFAULT_*` constant, test hook is not configurability. Protocol constants, external specs, security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at earliest resolvable point; never silently skip missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `gnk-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback, hostile-input tests solely for values static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates/tests resolve workspace imports via tsconfig `paths` to `src` and pass on clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** Package with both Host and Client programs exposes face-specific leaf configs and solution-only root; repo-wide programs seed face config, never root solution ([layout](docs/development.md#typescript-project-layout)).
- **Empty `catch` names what it swallows**.
- **Keep comments local.** Do not restate code, explain distant behavior unless locally required, or expand unrelated comments ([rationale](.agents/notes/implemented/process/2026-08-09-concrete-prose-names-actors-and-recorded-facts.md)).
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in PR.
- **Non-trivial changes MUST include an Agent Note in same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Client UI copy is locale-owned.** Route product text via typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy ([decision](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model-/product-user-visible change updates keyless recorded-session snapshot; [snapshot ownership](snapshots/AGENTS.md) reserves top-level tree for session-driven cases and keeps other expected output owner-local. Fixtures replay on macOS/Linux; fix fixtures, not normalizers.
- **Design each tool's UI presentation up front.** Host presenters stay pure; Web cards derive from raw events and persisted result metadata ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in same change.
- **Both SDKs project the loop.** Agent-loop, session-lifecycle, and `SessionEventMap` changes update TypeScript and Python SDK expected outputs in same PR; `pnpm run test` covers neither ([surfaces](docs/testing.md#when-a-snapshot-test-is-required)).
- **Choose PR history deliberately.** Split independent changes and fix introducing PR before propagation. Standalone/stack branches may merge-forward or rebase. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; preserve in-progress merge-forward checkpoint before taking newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module/export has concise JSDoc for non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep docs at declaring Service Definition, protocol, or class.

Comments/docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms; no metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether exact term names subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, obligations callers, callees, implementers, providers, producers, or consumers rely on. Keep literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, safe-use facts; link rationale. Use [gnk-prose-standard](.agents/skills/gnk-prose-standard/SKILL.md) for decisions. Wire checkable invariants into executed top-level gate and prove each changed acceptance path rejects invalid case. Use narrow, justified exceptions instead of disabling rule globally.

Docs accompany every code change: update affected README, JSDoc contracts together. Current-state prose, one physical line per paragraph, one home per fact, and word budgets live in [docs/AGENTS.md](docs/AGENTS.md).

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives; raise `verify-doc-budgets` ceiling when required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via sync procedure there; re-apply or retire logged local modifications; rerun `pnpm run test && pnpm run build`.

# Greeneek v0.3.4 → v0.3.6 — implementation ledger

Status owner: main session. Evidence is a command actually run on this checkout or a commit/CI link, never a plan or note restating intent.

Labels: DONE-VERIFIED / IMPLEMENTED-UNVERIFIED / PARTIAL / NOT STARTED / BLOCKED.

Baseline: work continues from `main @ 625a9ba5` (Army browser surfaces, preset, and gate hygiene: commits `3a501389`, `f143e73d`, `f857d6bd`, `625a9ba5`, `5348b38f`, all pushed 2026-10-25). Fix branch `fix/army-roster-catalog-pins @ 2309f484` carries the CI pins. Plan baseline `c66636d8` is historical.

## Blockers to record honestly

- `gh` is unauthenticated in this environment: no PR can be opened for the fix branch, and issue #86 cannot be updated. Unauthenticated Actions log download returns 404, so CI logs are read only from the check-run summary.
- No `GREENEEK_API_KEY` and no root `.env`: every live model flow, `test:e2e`, `test:snapshot:record`, and the Web goldens refresh are NOT RUN.
- Replay lanes are unusable on this Windows host: `apps/web/tests/scaffold.ts` injects a `C:\…` workspace path into fixture JSON (34 parse failures, 44 Web suites), and `test:snapshot` compares against POSIX paths (92 ACP/SDK cases). Documented in `docs/testing.md` at `5348b38f`.

## v0.3.4 — Foundation

| Requirement | Status | Evidence | Work remaining |
|---|---|---|---|
| M0 CI repair: shipped roster and plugin-catalog pins | PARTIAL | `pnpm exec vitest run packages/preset/agent-presets scripts/gen-plugin-catalog.spec.ts` → 13 files / 194 tests pass on the fix branch; CI's two named failures are exactly these | Observe green CI on `2309f484`; requires a PR (blocked: gh auth) |
| M0 baseline, tag scheme, upstream-sync table | PARTIAL | plan §12 records owner decisions; `desktop-v0.3.4` tag exists at `87ef47f`, `gh release view` unverified here | Owner question: npm/CLI/desktop version and tag scheme before any tag |
| M1 Light `#EEEEEE` ramp, elevation ladder, hard-coded whites, Electron startup flash | IMPLEMENTED-UNVERIFIED | commit `1ab9ca22` | Re-derive contrast per text role including `label-caption`, with an executable check rather than a table; `ModelSelect.module.css` still references `--dsw-static-neutral-00` |
| M1 PTC pill removed, preset and replay preserved, stale default sanitized | DONE-VERIFIED (pill only) | commits `837f0975`, roster tests above; `test:gui` 4138 tests | The accepted decision is stronger: migrate PTC capability into Standard through a lazy, token-measured path and prove no schema inflation — NOT STARTED |
| M2 Craft headless pilot (PhotoCraft, PdfCraft), lazy gateway, roots, tokens | IMPLEMENTED-UNVERIFIED | `packages/craft/{craft,craft-local,tool-craft}`, `packages/client/ui-craft`, `toolFilter` in `mcp-client` | Manifests carry `verified: false` and `craft.example` URLs; no real-Windows artifact smoke; desktop-only claim unproven |
| M2 Pixels Designer and Instructor flagship flows with evals | PARTIAL | preset YAML in `packages/preset/agent-presets/presets/` | One tested flagship flow each, eval fixtures and rubrics, capability-detect UI states |
| M3 wave engine: 8/16 semaphore, budgets, cancellation, partial success, structured results | DONE-VERIFIED | `packages/subagent/wave` + its 42 tests; `pnpm run test` full-suite run on this checkout | none for the listed scope |
| M3 Lead tools `wave_dispatch` / `wave_cancel` | DONE-VERIFIED | `packages/subagent/tool-wave` tests (31) | none |
| M3 durable `wave/*` session events + persistence catalog + SDK projections | DONE-VERIFIED | `packages/subagent/wave/src/types.ts`, `docs/persistence-catalog.md`; doc-sync 30 gates | none observed by me beyond catalogs |
| M3 Army selectable and composed | DONE-VERIFIED | `presets/army/{preset.yml,agent.cordis.yml}`; `pnpm run verify-runtime-closure` → "6 agent presets and 132 workspace packages form a closed runtime dependency graph"; pill row enabled in `AgentPresetSeat.tsx` | live selection flow needs an E2E pass with a key |
| M3 browser fleet: Fleet tab, composer pill, stops, child open | DONE-VERIFIED (component level) | `packages/client/ui-wave` 44 tests; scoped coverage 100%; `pnpm run test:gui`; `pnpm run publint` | not exercised in a live wave |
| M3 fleet UI as specified (rows with current/last tool, budget, duration, artifacts, member drawer, auto-open on wave start, 10–15 Hz event batching) | PARTIAL | deviations recorded in `.agents/notes/implemented/feature/2026-10-25-army-fleet-surfaces.md` | `WaveMemberView` carries no last-tool/duration/artifact fields, so engine view extensions or a different source are prerequisites |
| M3 live E2E (success, partial, cancel, budget kill, narrow-width stop) + recorded scenario | BLOCKED | needs model key; Linux for goldens | write `snapshots/web/` fleet case and session recording |
| M4 Maestro G1 (agent-team promotion, preset children, worktrees, confirm card, hash trust, benchmark) | NOT STARTED | `packages/experimental/agent-team` unchanged | entire milestone |
| v0.3.4 release gate | NOT READY | M4 missing; CI not yet observed green on a commit; live sweep incomplete | — |

## v0.3.5 — Product expansion

Maestro G2 fleet settings and CLIs, all 13 ArtCraft apps, Arabic with RTL, and the Dashboard are NOT STARTED. Their prerequisites are known: Arabic needs `packages/client/locale/src/locale-settings.ts` (en, zh only) plus key parity across three dictionaries and logical-property CSS; the Dashboard needs cost provenance, so provider pricing must be verified at build time rather than assumed.

## v0.3.6 — Hardening and graduation

NOT STARTED. Owner-requested paired free-model subagent debate/red-team passes and the preview→production graduation decisions land here.

## Working notes

- Subagents: not used for this work yet. No free DeepSeek V4.1 route has been verified from this environment, so no claim is made about one.
- Commands run in this session: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run test:gui`, `pnpm run doc-sync`, `pnpm run publint`, `pnpm run constraints`, `pnpm run verify-runtime-closure`, `pnpm run duplication`, scoped coverage, `GNK_SNAPSHOT=replay pnpm run test:web`, `pnpm run test:snapshot`, the catalog generators, `pnpm install --frozen-lockfile`, `./scripts/brand-sweep.sh`, and `pnpm --filter @greeneek/desktop test`.
- `pnpm run test` on this host: 1010 files / 16459 tests pass; 11 files / 26 tests fail. Two are the roster and catalog pins fixed on `2309f484`; the remainder are in `scripts/` host-process specs (`oxlint-contract`, `change-scope`, `build-exe-for-python-sdk`, `benchmark-npm-resolution`, `client-build-environment`), `packages/util/home-paths` legacy compat, `packages/experimental/inspector` worker suites, and one `ui-primitives` lazy-grammar spec that passes in isolation — all candidates for Windows-environment causes, still unattributed individually.

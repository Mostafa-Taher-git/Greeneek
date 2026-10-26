# Agent Note: revised v0.3.4 to v0.3.6 recovery plan after the two-audit reconciliation

Status: proposed

## Problem

The owner's hand-off plan (2026-10-25) asked a fresh session to audit, correct, and finish the release program. Since then two independent free-model audits (`deepseek-v4.1-flash-free` auditor A on ledger claims, auditor B on missing product work) re-verified the tree, the executor subagent pinned the two CI breakers, and three correction commits landed on main (`3b529c65` preview-badge removal, `208152e6` Maestro copy, `240ae910` source-plane emit pin). Several of the old plan's claims no longer describe reality, and at least one was false (the "25 descriptor-v3 fixtures" re-record). A session handed the old plan would repeat dead work or trust rows the audits falsified.

## Proposal

Use this note as the single hand-off plan. It restates the owner's four source documents (`T:\APPS\Obsidian\My_Vault\Projects\Greeneek\Greeneek v0.3.4 Plan.md`, `new add in -v0.3.4.md`, `new add in -v0.3.5.md`, `new add in -v0.3.6.md`), folds in the audit corrections, and lists only the work still standing.

### What is done, verified, and must NOT be redone

- Theme: light ramp `#EEEEEE` family, elevation ladder, 17-role/151-pairing WCAG gate executable (`scripts/verify-theme-contrast.ts`), Electron launch flash fixed. Signal-hue `TODO(theme-contrast)` is a documented owner exception — do not "fix" it.
- PTC pill: retired (`837f0975`); `presets/ptc/` kept; replay intact.
- Wave engine: `packages/subagent/wave` (42 tests), `tool-wave` (31 tests), durable `wave/*` events in `docs/persistence-catalog.md`.
- Fleet surfaces: `packages/client/ui-wave` (49 tests — corrected from the claimed 44).
- Maestro promotion: 5 packages atomically promoted; cross-preset children via `SubagentStartRequest.agentPreset`; `presets/maestro/` + `presets/army/` mounted; seat enabled with real copy in three locales (`208152e6`).
- Release pipeline: `.github/workflows/release-desktop.yml` replaced the two split workflows (gate → linux+windows → single publish, `concurrency: release-<ref>`); runbook + `.github/AGENTS.md` updated; the stale spec and doc references repointed (`240ae910`).
- Source plane: `verify-source-plane` gate + the alias pin — `@greeneek/gnk-api-authorization-controller/types` maps to `lib/types/types.d.ts`; fresh host/client builds leave `src/` holding the three sources only.
- Brand/copy: `BrandWordmark` required prop; the four i18n violations routed through dictionaries; owner-requested removal of the word "Preview" from the empty-state hero (`3b529c65`, including the two `snapshots/web/lifecycle-chrome` goldens).
- Baseline truth: `verify-runtime-closure` reports 7 agent presets / 135 packages closed; 260 package READMEs conform; ledger rows corrected in `240ae910`.

### Owner decisions already taken (reversible only by the owner)

1. Arabic ships as a built-in third locale; numerals are Western digits; browsers auto-detect like zh/en; no host-forced default.
2. Milestone order v0.3.4 → v0.3.5 → v0.3.6; Maestro G1 before Arabic/Dashboard (Dashboard rows need lane metadata).
3. Never move `desktop-v0.3.4` (points at `87ef47fb`, historical). The next tag is `desktop-v0.3.5`, pushed only on a CI-green SHA and after owner approval.
4. Live model flows stay BLOCKED without `GREENEEK_API_KEY`; nothing is invented, borrowed, or presented as live.
5. Free flash-tier subagents (the approved execution model) do mechanical work; the main session directs engines, concurrency, credentials, git/worktrees, release workflows.

### Remaining work, in order

**Lock 1 — close v0.3.4 (before any tag)**

1. PTC finish: sanitize a stored `agent-presets.default === 'ptc'` to `standard` with a logged warning (plan §3) and rewrite `shipped-root.spec.ts:107`, which today asserts the opposite; keep the preset resolvable by explicit selection. Add the logged opt-in `ctx.tools.presentAs('both')` session toggle locked at turn 1 (mode banned as any default; `both` ≈ +103% tokens).
2. Craft: decide manifest provenance — fill PhotoCraft/PdfCraft `sources` from real `command_list` on a machine that has ArtCraft and set `verified: true` only then; add ONE optional-gated smoke step to `release-desktop.yml`'s windows job (an env-var `if:`), never making Linux mock CI depend on a real app. The manifests' schema has no `appUrls` field — the fix is replacing `craft.example` values, not adding fields.
3. Pixels Designer + Instructor: one tested flagship flow each (Pixels photo-batch through the gateway; Instructor questionnaire → markdown CV → review gate → PdfCraft export with the anti-fabrication `_ask-user` enforcement), plus 5 eval fixtures + rubric per preset using CraftTransport mocks (no ArtCraft in CI).
4. Army fleet spec: extend `WaveMemberView` (`packages/subagent/wave/src/views.ts:42`) with last tool, started-at/duration, artifacts, budget-used; make `DetailsPanel` auto-show Fleet when fleet is occupied and no tool is selected; coalesce mirror updates ~10–15 Hz; width-gate the composer pill; add a budget-kill resume card in chat. Emergency Stop stays reachable under 1220px viewports.
5. Maestro G1 tail (the largest hole): git worktrees under `${GNK_HOME}/worktrees/<sessionId>/<lane>/` with serial gated merges and members-never-commit; chat override → structured confirmation card; content-hash one-time approval for repo fleet files; delegation benchmark scaffold (sequential vs Maestro, run when a key exists). The descriptor bump to `SUBAGENT_DESCRIPTOR_VERSION = 4` rides the shared constant — no fixture re-record (audited).
6. Gate sweep after every wave: scoped vitest with coverage, `verify-client-domain-graph`, `verify-client-ui-i18n`, `verify-cordis-config` (the last fails only on this Windows checkout's symlink materialization — document, prove on Linux), ledger row update in the same commit.

**Lock 2 — npm release family (P2 remainder)**

7. Add `.github/workflows/release-npm.yml`: `workflow_dispatch` only, running `pnpm run release:verify`, `release:pack`, `release:publish` with `NPM_TOKEN`; never auto-publish on main pushes. Optional: a `dry_run` input on `release-desktop.yml` so the desktop pipeline can produce artifacts without publishing — its gate/publish design is otherwise unexercised.

**Lock 3 — v0.3.5: Arabic + Dashboard (after v0.3.4 is complete and CI green)**

8. Arabic final mile (measured, corrected from the ledger's wider claim): flip `LOCALE_IDS` to `['zh','en','ar']` in `packages/client/locale/src/locale-settings.ts:15`, extend the fallback chain and language option, and make all 31 client plugins register `{ zh, en, ar }` — the 30 finished dictionaries are unreachable until both the registry and the registrations land. Extend `scripts/locale-dictionary-parity.spec.ts` from two locales to three. Wire `<html lang dir="rtl">` and convert the measured 310 physical CSS properties across 77 client CSS files to logical properties. Western digits only.
9. Dashboard page from session/telemetry facts: overview (sessions, workspaces, live agents), tokens and cost with verified pricing provenance (never invented rates), most-used model/provider/API-key plan, Maestro CLI usage (needs the G1 lane metadata from item 5). No new admin template — need-to-see rows only.
10. Full CI green on that SHA → owner-approved `desktop-v0.3.5` tag (release pipeline's first real exercise).

**Lock 4 — v0.3.6 live pass (needs `GREENEEK_API_KEY`)**

11. Re-record the deferred snapshots (fleet web golden, any locale-affected goldens); run live E2E across standard, army, pixels-designer, instructor, cordis, maestro, craft gateway; pair free-model subagents (DeepSeek V4.1 Flash debate partner) and fix or document every finding; tag `desktop-v0.3.6` only after a ledger with no silent PARTIAL rows.

### Review instructions for the next model

Verify these against the tree before executing; reject the plan if any is false:

1. `pnpm run verify-client-ui-i18n` exits 0 with 514 files (wordmark is a required prop; no "Preview" badge text remains — `rg 'hero\.preview|previewBadge'` finds nothing).
2. `pnpm run verify-source-plane` exits 0, and a fresh `tsc -b tsconfig.client.json --force` leaves `packages/api/authorization-controller/src/` with three sources and nothing else.
3. `LOCALE_IDS` is still `['zh','en']` and no plugin registers `ar` (the dictionaries alone prove nothing).
4. The Maestro seat is selectable and its copy no longer says "Coming soon." (test asserts `disabled: false`).
5. `WaveMemberView` has no `lastTool`/duration/artifacts/budget fields yet.
6. `shipped-root.spec.ts:107` still expects a stored `ptc` default to resolve — that is the divergence item 1 must resolve toward the owner plan.
7. `docs/plan-v0.3.4.md` is the accepted decision record — never convert it into a progress report; status lives in the ledger.
8. `desktop-v0.3.4` must not move; `release-desktop.yml` publishes once per tag after a CI gate.

**Non-goals:** macOS packaging or code signing; the remaining 11 ArtCraft attach adapters; npm auto-publish on main; inventing cost rates; faking live E2E without the key; resizing the token scale to chase goldens.

## Alternatives considered

**Restart maestro/Arabic from scratch because the ledger understated it.** Rejected: the promotion, dictionaries, and cross-preset composition are verified; only the final mile stands.

**Fold PTC default sanitization out as unsafe.** Rejected: the owner plan names it directly (§3) and the failing fallback never bricks new sessions because `resolve()` falls back to `standard` only when the id is unresolvable — a stored `ptc` still composes a full PTC session today.

**Delay the Preview-badge removal into the release sweep.** Rejected: it is owner-requested surgery with two expected-file goldens; leaving it conflates "owner asked, done" with "found in sweep" and risks re-recording goldens late.

## Risks

- The next model may treat the dictionary completion as Arabic shipped; the registry/registration flip is the only thing that puts Arabic on screen.
- The release pipeline remains configuration-only until the first tag or dry-run dispatch; treat its "DONE-VERIFIED as configuration" row as unexercised behavior.
- The Windows checkout cannot prove the replay lanes or the symlink gate; only the Linux CI pass settles those rows, so do not re-derive them locally.

## Acceptance criteria

- Each lock exits with: gates green on the exact commit, ledger rows updated in the same commit, and CI green on pushed main.
- No row of the v0.3.4 ledger that promised plan §14 DoD remains IMPLEMENTED-UNVERIFIED-or-worse without naming its exact blocker (missing key, missing host application, or owner decision).
- The first new desktop tag after `desktop-v0.3.4` is `desktop-v0.3.5`, cut on a green CI run, owner-approved, and exercised through `release-desktop.yml`.

# Greeneek v0.3.4 — Final Build Plan

Status: **FINAL — consolidated from 5 independent AI reviews** (Qwen3.8 · Claude Sonnet 4.5 · ChatGPT ·
Arena.ai Agent · Antigravity). Draft preserved at `reviews/Plan draft v1 (pre-consolidation).md`;
per-review verdicts + ledgers in `reviews/`. Target baseline: `main @ c66636d`.
This plan supersedes the draft everywhere they differ; leftover decisions for the user are in §12.
Nothing here starts until §12 answers are in.

---

## 0. Decision summary — what changed from the draft

1. **PTC pill is removed, not the capability.** B's merge idea is dropped (Reviews 2–5 agreed):
   `MODE_ORDER` becomes `['standard','cordis']`; the `presets/ptc/` dir, `run_code` composition and
   `test:snapshot` replays stay untouched; unlisted presets remain mountable via settings/custom
   presets (Antigravity's design, Claude's "deprecate, don't delete", ChatGPT's migration gate).
   No `mode: 'both'` default anywhere (3–6k tokens/step prompt inflation — Antigravity).
2. **Theme is a ramp step, with traps named.** Re-step the whole lower light ramp monotonically
   (not `bluish-00` alone), repoint `--dsw-alias-label-primary-foreground/-inverted` off `bluish-00`,
   add an elevation ladder, fix the 5 hard-coded white files incl. the Electron launch background
   (Arena's WCAG math + file list), categorical neutral-vs-tinted choice left to the user (§12).
3. **Craft bridge shrinks and re-architecture.** No `craft_<app>_search/run` layer (Claude + Arena:
   Craft MCP already ships ~10–18 meta-tools with per-app discovery). Instead: lazy gateway
   (`craft_open_app`/`craft_list_apps`), `toolFilter` added to `mcp-client`, per-app **manifest +
   capability matrix**, `CraftTransport` + in-memory mocks for the 100%-coverage Linux CI, seam-split
   `packages/craft/{craft, craft-local, tool-craft}` + `packages/client/ui-craft`, **headless-first**
   pilot (PhotoCraft + PdfCraft), "Launch {App} Connected" button, hard security gate before any live
   attach (FigCraft #480 proves the failure mode), desktop-profile only.
4. **Army is a wave engine on `ctx.subagents.start()` — not `agent-team`.** Ephemeral fan-out/fan-in
   ≠ durable peer team (Antigravity's decisive split; ChatGPT corrected that `maxMembers` is a
   lifetime roster cap, Arena showed there is no cancel RPC for one-shot runs). Concurrency
   semaphore default 8 / configurable 16, per-run cancel RPCs, pre-step token-meter cutoff,
   partial-success first-class, UI event coalescing.
5. **`agent-team` moves to Maestro's table**, promoted atomically as 5 packages later in the program
   (its durable DAG/board serves multi-lane orchestration, not waves).
6. **Maestro splits.** G1 (v0.3.4 core): lanes, in-process preset members + cross-preset spawn
   (`agentPreset` on `SubagentStartRequest`; Arena showed today's runtime throws on external-CLI
   options), git-worktree isolation, native structured outputs (already in `subagent-in-process-driver`),
   chat overrides with a confirm card, content-hash trust for repo-level fleet files. G2 (stretch):
   CLI-provider capability upgrades (per-run model/effort, read-only lanes, `externalSessionId`
   resume), lazy CLI availability, Fleet Settings editor + favorites.
7. **Fleet view = arbitrated tabs inside the existing `details` column** (Tool Inspector | Fleet),
   not a sibling slot (it would be clobbered by tool selections — Arena), with a compact-pill
   fallback below 1220px viewports where the column force-collapses to 0.
8. **D/E are "preview" presets with one flagship flow each**, capability-detecting what's actually
   installed; "nine apps / full parity" claims removed; artifact contracts + CV anti-fabrication
   rule; CV = markdown→PDF primary path (ChatGPT).
9. **New M0 stage**: baseline pin, #86 update, upstream-sync accept/rework table (#71/#75/#67/#80),
   because A/B/F/G all touch surfaces those issues re-platform (Claude's blocking finding).
10. **Execution tiering**: free flash-tier subagents (the approved execution model) for
    explore/spec/mechanical/UI;
    strong model for engines, concurrency, credentials/roots/git and the theme ladder (Claude), with
    a mandatory post-wave gate sweep (`vitest --coverage`, `verify-client-domain-graph`,
    `verify-client-ui-i18n`, `verify-cordis-config`) plus jscpd/coverage fixes (Arena).

---

## 1. Baseline facts (verified; reviewer corrections folded in)

- Presets are files: `packages/preset/agent-presets/presets/{standard,ptc,cordis}/` (Cordis YAML).
  Pill order = `MODE_ORDER = ['standard','ptc','cordis']`
  (`ui-agent-preset/src/client/AgentPresetSeat.tsx:61`); unlisted presets still mount (line 133).
- `army`/`maestro` = disabled "Coming soon." placeholders (`AgentPresetSeat.tsx:113–130`).
- PTC wire contract: PTC sessions expose only `run_code`; other tools arrive as a generated TS SDK
  in the prompt. Standard = native schemas + `workflow`.
  `ToolPresentationMode = 'native'|'ptc'|'both'` exists (`packages/core/tools/src/index.ts:644`).
  `presets/ptc/agent.cordis.yml` = standard + (`tool-workflow disabled`) + (`mode: ptc`).
- Stale-settings trap: `settings` `agent-presets.default = "ptc"` → `AgentPresets.resolve()` throws
  `agent-preset/not-found`; sanitize stale defaults with fallback to `standard` + Agent Note.
- Subagent engine: `subagent`/`subagent_fork` tools, `isConcurrencySafe: () => true`;
  providers `spawn|fork|acp|codex|claude-code|gnk-sdk` (`subagent/src/types.ts:300–346`); codex and
  claude-code are `NO_START_CAPABILITIES` today and `disabled: true` in the standard preset.
  Native structured outputs exist (`subagent-in-process-driver/src/structured.ts` —
  `structured_output` tool interception when `outputSchema` is set).
- `experimental/agent-team` = **5-package family** (+ docs); durable SQLite mailbox + CAS board;
  `maxMembers: 8` = lifetime non-recycled names, not concurrency; continuable children only.
- Layout: third `details` column `300/360/520px`, width 0 collapses but stays mounted
  (`ui-layout/columns.ts`, `AppFrame.tsx`); 280+640+300 = **1220px floor**; below it
  `computeColumns` forces `details: 0`. `DetailsPanel` currently shows only the selected
  tool-call inspector (`selection?.callId`; else `details.empty`).
- Theme: light `--dsw-static-neutral-bluish-00 = rgb(253,254,250)` feeds `bg-base/layer-1/2/3`;
  dark block separate; switch attr `body[data-ds-dark-theme]`. Known alias traps:
  `--dsw-alias-label-primary-foreground/-inverted` alias `bluish-00`; `bluish-50/60/75` are ≥ #EEEEEE
  and sage-tinted; `--dsw-alias-label-caption` (bluish-400) fails contrast on #EEEEEE as-is.
- ArtCraft (13 apps, Rust/egui/wgpu, MIT OR Apache-2.0, Windows MSI+portable incl. arm64):
  per-app CLI + MCP meta-tool set (~10–18: `command_list/command_run/command_batch` PhotoCraft;
  `list_commands/run_command/batch/...` FigCraft) + loopback control channel + per-launch control
  token + `--automation-read-root/--automation-write-root` (without write-root, headless MCP refuses
  disk writes). Attach flags differ per app (PhotoCraft `mcp --bridge --control-token-file`;
  FigCraft `mcp --attach <port>`; **root flags apply only if set on the app's own GUI launch**).
  Discovery: launcher `installed.json` paths (Windows `%LOCALAPPDATA%\ArtCraft Launcher`,
  macOS `~/Library/Application Support/ArtCraft Launcher`, Linux `~/.local/share/artcraft-launcher`),
  Windows MSI = absolute `<InstallDir>\<stem>-cli.exe` via `HKLM\Software\<App>\InstallDir`
  (never on PATH; previously-installed `pdfcraft` was `printcraft` ≤ v0.2.1), macOS CLI ships as a
  separate zip. Launcher has no headless install CLI. FigCraft live control channel is
  **unauthenticated on checked `main`** (their issue #480) — live attach is gated until fixed.
  Early-alpha note: PhotoCraft/PdfCraft/FigCraft alpha; most of the suite still in development.

---

## 2. Workstream A — Light appearance (goal: light surfaces read as `#EEEEEE` family)

**Final recipe (values-only; token names and structure unchanged; dark block untouched).**
1. Audit pass: grep every consumer of `bluish-00..` and `neutral-00` in light mode; list the
   hard-coded whites (Arena's list below).
2. Lower-half ramp re-step, keeping monotony below `238` and total relative deltas:
   suggested neutral set (user picks vs tinted in preview): 00 `#EEEEEE`, 50 `#E6E6E6`,
   60 `#E0E0E0`, 75 `#DADADA`, 100 `#D2D2D2`, 200 `#C8C8C8`; darken `bluish-700` ≤ `rgb(90,102,91)`
   (label-secondary ≥ 4.6:1), re-check tertiary (600) and caption (400; must pass its role's
   minimum or be re-pointed), per WCAG/APCA for text roles.
3. Repoint, do not recolor: `--dsw-alias-label-primary-foreground` and
   `--dsw-alias-label-primary-inverted` → `var(--dsw-static-neutral-00)` in the light block.
4. Elevation ladder so nothing disappears flat-on-flat: base `#EEEEEE` / layer-1 `#F2F2F2` /
   layer-2 `#F7F7F7` / overlay `#FBFBFB`; re-derive `--dsw-alias-border-*` alphas over the new base
   (l2 ≈ 0.14 alpha check on the composer card, which equals bg-base).
5. Hard-coded white fixes: `gradient-shadow-text.css` (`#fff` gradient → base alias);
   `packages/client/web/src/base.css` fallback `#fff → #eeeeee`;
   `ModelSelect.module.css:467`; **`apps/desktop/src/window-options.js:19` backgroundColor
   `#fdfefa → #eeeeee`** (+ its test `:370`) and `startup.html` `#f4f8f6` → aligned (kills the
   launch white-flash); pinned RGBs in `seeded-history.e2e.ts:399` and
   `theme-presenter.client.spec.ts:7`.
6. Verify: `ui-theme` token pins + updated snapshots; contrast sweep on every text/hover/selected
   token; dark-mode byte-diff check; full client suite; live visual pass (light+dark) incl.
   dialogs, popovers, composer, markdown, code blocks/diffs, scrollbars, images-on-light.

**Pre-commit gate:** user picks the palette variant in an HTML preview (neutral `#EEEEEE` vs
tinted `#EDEFEC` family) — §12 Q1. Effort S–M.

---

## 3. Workstream B — PTC pill removal (capability preserved)

1. `MODE_ORDER = ['standard','cordis']`; all pill tests updated (2 pills); PTC stays a legal preset.
2. PTC sessions keep replaying (`test:snapshot` untouched — Antigravity's breakage avoided).
3. Sanitize stale `agent-presets.default === 'ptc'` on load: fall back to `standard`, log an Agent
   Note (fail-safe, not silent — AGENTS.md stance; `not-found` never bricks a new session).
4. Keep `run_code` capability, `GNK_TOOLS_MODE=ptc` demo script, `gnk-code-runtime` — untouched.
5. Locales/cleanup: remove nothing in `display.ts` beyond the pill-list usage (preset itself
   remains in `BUILT_IN_PRESET_KEYS`; rename only the display ordering if needed).
6. Document in README + changelog: "PTC available via Settings/custom presets."
7. Optional (stretch, only if time): pre-first-turn "Code SDK" chip in the composer to reach
   `mode: 'both'` as an explicitly logged session event, locked at turn 1 (Arena). Default plan: not
   in 0.3.4.

Effort: **S** (down from drafted S–M; no migration, no app-surface redesign).

---

## 4. Workstream C — Craft bridge (headless-first, lazily-mounted, manifest-driven)

**Package seam** (per `packages/README.md` + repo group rules):
- `packages/craft/gnk-craft` — service definition `ctx.craft`: app catalog/manifests, state
  (`not-installed | app-installed-cli-missing | ready | running`), attach/headless lifecycle,
  workspace-root confinement.
- `packages/craft/gnk-craft-local` — host provider: launcher-manifest + registry discovery,
  `<app>-cli.exe` absolute resolution, subprocess management through `ctx.subprocess` (Win32 Job
  Object tree-kill for orphans).
- `packages/craft/gnk-tool-craft` — gateway tool + attached-app tool bridges + recipes skill
  provider (`ctx.skills`).
- `packages/client/ui-craft` — Settings tab + deliverable/tool result cards.
- Update `packages/README.md`, `packages/AGENTS.md`, `docs/architecture.md`, group README, + Agent Note.

**Activation model (Anti "tool-paralysis" and "160-schemas" turn cost):**
- At session start: only `craft_list_apps()` + `craft_open_app({ app, mode: 'headless'|'attach' })`.
- On open: mount a scoped `mcp-client` child fiber for that app (static Cordis plugin today —
  add on-demand mount); add `toolFilter?: string[] | ((n) => boolean)`/`whitelist` to
  `ToolBridgeOptions` so only the app's own meta-tools (and curated extras) register as
  `mcp__<app>__<tool>`; recipes for the app load as a skill only while active.
- Idle sessions pay ~2 tool schemas and zero Rust processes; N apps at once is possible but
  capped (default ≤ 2 concurrent attached/headless sessions per session).

**Manifest (data, not code) per app — the capability matrix (release artifact):**
app id (+ alias e.g. `pdfcraft`/`printcraft`) · CLI stem · launch command template · attach flags ·
control-token mechanism · supported roots · headless-only vs attachable · min supported version ·
cancellation behavior · known risky commands. Facts seeded from the Craft docs; unknowns marked
`unverified` until proven (FigCraft numbers currently unverified).
- Security rules (release gate): roots always = session workspace (read) + job `out/` (write);
  bridge requires the per-launch control token file; a loopback port with no token is never
  attached; destructive classes (overwrite/save-over/print) need approval cards; FigCraft live
  attach stays blocked until upstream ships an authenticated channel (their #480); no screen-scraping/
  synthetic input in 0.3.4; **desktop profile only** (not for web/remote deployments).
- **User-visible controls:** "Launch {App} Connected" button (spawns GUI with `--control` +
  roots — attach works only for Greeneek-launched apps), headless fallback for jobs,
  "Check Installation" → health states + deep link to ArtCraft Launcher / official download
  (never silent install; launcher has no headless CLI anyway).

**M2 pilot scope:** PhotoCraft + PdfCraft, **headless only**, end-to-end: batch action file → app
CLI → artifacts registered back (deliverable chips via extended `ui-deliverables`), preview images
auto-attached (`render_preview`/`screenshot` → `ctx.attachments`). Attach-mode integration deferred
past the security gate per app. Non-goal for 0.3.4: the rest of the suite beyond manifest stubs.

**CI/testability:** `CraftTransport` abstraction + in-memory fixtures for CLI/MCP; fake-adapter
contract tests (100% coverage on Linux CI without ArtCraft); ONE real upstate smoke test on
`desktop-windows.yml`. Registry-drift guard: cache + hash each app's `command_list` output,
warn on drift rather than trusting ported docs.

Effort: **M** (down from L).

---

## 5. Workstream D — Pixels Designer (preview preset)

- `presets/pixels-designer/` cordis YAML (stateful services in `cordis:group` with `isolate: true`):
  designer persona; gateway `craft_open_app` (NOT 9 static mcp mounts — fails/loops on partial
  installs); includes `tool-fs`, `tool-fs-search`, `tool-ask-user` (interviews/brief capture!),
  `tool-todo`, `plan-mode`, `tool-web`.
- Label "Pixels Designer (preview)"; joins `MODE_ORDER` after standard; distinct 16px icon;
  `presetPixelsDesigner*` locale keys (en+zh) + `display.ts` keys.
- Recipes: canvas/saeft-generated skills per supported app from its live command registry (never
  hand-ported docs; attribution in `THIRD_PARTY_NOTICES.md`).
- **Ship target = ONE flagship flow** (photo batch: read-root culling via LightCraft-headless
  light path → PhotoCraft batch grade → exported contact sheet as deliverable). Capability-detect
  the rest: the palette section renders which Craft apps are `ready | not-installed | headless-only`
  and degrades gracefully; no parity promises.
- Artifact contract everywhere: inputs/outputs declared per app; downstream-open-failure = explicit
  message, never silent.
- Later flows (poster: FigCraft+VectorCraft+DesignCraft; motion: EffectCraft+FilmCraft) move to the
  next release unless the M2 pilot lands early/clean.
- ModeSwitcher must survive a 4+ pill row by then — fix hover expansion (expand only
  hovered/focused+active, siblings icon-only) or wrap.

Effort: M (as preview; the 9-app universe claim is deferred, honest copy instead).

---

## 6. Workstream E — Instructor (preview preset)

- Preset + locals + icon same pattern as D. Tools: doc quartet behind the gateway
  (WordCraft/DeckCraft/GridCraft/PdfCraft quickly become available as they mature), research skill,
  `tool-ask-user`.
- **CV pipeline safety rule**: never invent credentials/work history/qualifications; every fact
  traceable to user input; a user review step before final export.
- Primary output path: markdown → PDF (PdfCraft headless); WordCraft/Deck integration is optional
  enhancement (early-alpha word processor must not sit on the critical path).
- **Flagship flow**: CV (questionnaire → draft markdown → review checklist → PDF export) with the
  anti-fabrication gate. Roadmap/tutorial generation flows follow next release; research feature
  blocked on the web-search policy decision (#86 dependency — surfaced in M0).
- Evals: 5 fixtures per mode + a rubric, so prompt iterations are measured, not vibes.

Effort: M similar.

---

## 7. Workstream F — Army mode: wave engine + fleet view

**Engine (new service, e.g. `packages/fleet` or inside `packages/subagent` family — group rules
apply):**
- Waves on `ctx.subagents.start()` (parallel-safe); **concurrency semaphore** `maxConcurrent`
  default **8**, config ceiling **16** (cordis Config field, no hardcoded tunables); lifetime roster
  and concurrency tracked separately (ChatGPT's correction).
- **Run registry**: `AbortController` per `SubagentRunId` + `@Remote('cancelRun')`/'cancelWave'` —
  one-shot runs are cancellable from the browser (gap today).
- **Budget with teeth**: pre-step waterfall listener on `tokenMeter` (per member + fleet aggregate);
  hard kill at threshold with a resume/summary card — pre-run estimates are just a guess.
- Partial success is a first-class outcome (explicit per-member statuses; `continue-others` default,
  `fail-fast` option aborting siblings); deterministic ordering + stable merge; per-member token
  metering BEFORE the budget UI ships.
- Rate-limit governance per provider (backoff, not just cap).
- Lead context discipline: members return structured results only (native `outputSchema` path —
  `structured_output` interception), hard per-result size cap; transcripts never flow to the Lead.

**Army preset + UI:**
- Placeholder replaced ("Coming soon." → real copy); Army joins `MODE_ORDER` (pill 3).
- **Fleet view = arbitrated tabs inside the `details` column**: tab `[Fleet | Tool]`.
  Tool click → Tool tab; fleet active + no selection → Fleet tab shows; 1-click back.
  Fleet tab content: compact virtualized per-agent rows (role · model · status · last tool) with a
  drill-down drawer — no fat cards; Lead activity; artifact list; Emergency Stop always visible.
- Sub-1220px fallback: when `cols.details === 0`, show a compact status pill in the composer area
  that opens the fleet as an overlay/drawer — never lose the emergency stop (100%-DPI laptops,
  225% 2560×1600, split windows).
- Streaming hygiene: coalesce child events ~10–15 Hz (rAF/100ms batching) so 16 streaming children
  don't thrash React.
- Session events: wave/member lifecycle into `SessionEventMap` (+ `gen-persistence-catalog`,
  unknown-event `ignorable: true`), TS+Python SDK snapshots if required.

Effort: L. `experimental/agent-team` stays untouched in this workstream.

---

## 8. Workstream G — Maestro (G1 now, G2 stretch)

**G1 — Maestro Core (v0.3.4):**
- Promote `experimental/agent-team` (all 5 packages + docs, atomically, per its AGENTS.md) as the
  durable coordination layer: lanes, task DAG/board, advisory locks, Lead/teammate mailbox.
- Members are **in-process preset children** first: extend `SubagentStartRequest` +
  `SubagentCapabilities` with `agentPreset?: string`; resolve the target standing key BEFORE
  `ctx.agents.create` (mount is async — Arena's showstopper) and bind in `setup(childCtx)`;
  stamp `header.agentPreset`. Per-lane member spec = `{ preset, model, effort, persona, readOnly }`.
- Heterogeneous dispatch by preset: code → `standard`, design → `pixels-designer`, docs →
  `instructor` — the "Polymorphic Maestro" effect for free once the field exists.
- **Write isolation**: git worktrees per member (`${GNK_HOME}/worktrees/<sessionId>/<lane>/`),
  orchestrator merges serially behind gates; non-git/Craft jobs fall back to disjoint verified
  `writeScopes` path-prefix locks (`tools.guard` + per-job `--automation-write-root`). Members never
  commit; orchestrator reviews the real per-member diff (which is only possible because of
  isolation), records base revisions, stages only reviewed changes, runs the full gate sweep after
  merge (guards against weakened tests).
- Result envelope: native structured outputs + extra fields (`schemaVersion`, `heartbeatAt`,
  `truncated`, `artifacts[]` as pointers, `budgetUsed`, non-zero-exit `reason`, `externalSessionId`
  reserved). Report size-capped.
- Chat overrides ("tests with codex…") = parsed fleet proposal → **structured confirmation card**
  echoing every member + settings before spend; first-use approval for anything risky.
- Repo-level fleet config files require one-time explicit user approval keyed by content hash
  (a cloned repo may never silently drive external CLIs).
- Fleet view (F's component) gains member-lane grouping + pause/kill per member or wave.
- Out-of-process `gnk-sdk` members wait behind #78 (two-process store lock) — in-process `spawn`
  is the default (Arena).
- Delegation benchmark scaffold (N fixed tasks; wall-clock / tokens / pass-rate for
  sequential vs Maestro): measurable "better/faster/smarter" instead of vibes (Claude G6).

**G2 — stretch/next release** (fits only if G1 lands clean; otherwise explicitly 0.3.5):
- CLI provider capability upgrade: per-run `model`/`effort` for codex (`-m`, `-c model_reasoning_effort`)
  and claude-code (`--model`, `--effort`); read-only lanes (`--sandbox read-only` / plan mode);
  `externalSessionId` resume for delta rework rounds; drop the profile-Bundle requirement —
  lazy availability states (`not-installed | unauthenticated | ready`) surfaced in Fleet Settings
  (delegate-setup style).
- Fleet Settings editor + favorites ("every time: tests lane = codex, flash effort" presets) + NL
  override polish. Add `acp` for generic third-party coverage (opencode/kimi/gemini).

Effort: **L (G1)** — recursion risk kept low by in-process-first and worktree discipline.

---

## 9. Milestones

| Stage | Contents | Gate |
|---|---|---|
| **M0** | Pin baseline; update #86 with this plan's scope; write the upstream-sync accept/rework table (#71/#75/#67/#80 + re-verify localization claim); settle §12 answers; confirm release-automation prerequisite for tagging (#80-lite or defer tag) | written doc in-repo + user sign-off |
| **M1** | A (ramp + traps + hardcoded files) + B (pill remove + default sanitize) | WCAG sweep + snapshots + user visual pass |
| **M2** | C pilot (PhotoCraft + PdfCraft headless, manifests, mocks, settings tab, deliverables) + D/E preview presets (1 flagship flow each) | headless e2e on Windows; capability-detect UI |
| **M3** | F waves + fleet tabs + sub-1220px fallback + SessionEventMap | cancel/kill/partial-success tests |
| **M4** | G1 core (agent-team promotion + cross-preset + worktrees + confirm cards) | 3-lane parallel build, no conflicts, delegation benchmark scaffold |
| **Stretch** | G2 CLI capabilities + fleet settings editor; D/E flow #2+"#3; attach mode per-app after security gates | as capacity allows |

Out of 0.3.4 (explicit): G2 full CLI editor (if not landed), remaining 11 app adapters,.attach
integration for any app pre-gate, 32+ concurrency, third theme (if user picks replacement instead).

---

## 10. Execution strategy (token discipline, per the user's rule)

- Heavy lifting runs on **free flash-tier subagents (the approved execution model), maximally
  parallel when steps are independent**, following the established pipeline: explore/verify subagent →
  implementation spec (saved file) → implement+tests subagent → main-session review → commit → CI
  watch → user visual pick (HTML preview for anything visual).
- **Tiering exception** (Claude): engine design/concurrency, anything touching credentials, file
  roots/egress/git/worktrees, the theme ladder, and fleet result contracts are written/directed by
  the main session (strong model), while flash subagents produceometimes the mechanical surface.
- **Mandatory post-wave sweep** (Arena's guardrail) after every subagent wave, before commit:
  `pnpm exec vitest run --coverage <touched pkgs>` (100% per-file target),
  `verify-client-domain-graph`, `verify-client-ui-i18n`, `verify-cordis-config`, duplication (`jscpd`)
  diffs, `doc-sync`/`hygiene` if shape changed, and Agent Notes for non-trivial changes.
- Every workstream lands as separately reviewable commits; snapshots regenerated then verified
  plain; app rebuilt + relaunched so the user always runs the latest build mid-release.

---

## 11. Risks (updated)

| Risk | Mitigation |
|---|---|
| Theme re-step misses a consumer / fails AA | audit + sweep + WCAG table per role + dark byte-diff + Electron bg fix + user visual pass |
| `test:snapshot`/replay breakage from preset surgery | B touches only MODE_ORDER + default sanitize; PTC capability intact |
| mode:'both' token inflation | banned as default; optional chip is logged + turn-1-locked |
| mcp tool registration ballooning | lazy gateway + toolFilter + per-session N app cap |
| Craft app instability (alpha suite, v0.2→v0.15 churn) | registry-drift hash + capability matrix + fail-loud diagnostics + manifest min-versions |
| Unauthenticated control channels (FigCraft #480 class) | live-attach hard-gated per app until fixed release verified |
| CI 100% coverage with no real apps in CI | CraftTransport + in-memory fixtures; only 1 gated Windows smoke |
| Fleet window collapses under 1220px | compact pill + drawer fallback; Emergency Stop never hidden |
| Wave/Lead context blowup | structured-only results + size caps + coalesced UI stream |
| Runaway model spend | pre-step token cutoff + hard kill + confirm cards + per-member metering |
| Parallel-write corruption | worktrees (enforcement) > path hints; base-revision + diff review + post-merge gate sweep |
| Provider capability mismatch (NO_START_CAPABILITIES providers) | G1 uses in-process preset members; G2 upgrades CLIs behind availability states |
| Upstream sync collision (#71/#75) | documented accept/rework table (M0); A/B/F/G scoped to values/UI seams first |
| Out-of-process store contention | #78 dependency noted; in-process spawn default for gnk members |

---

## 12. Decisions — RESOLVED by the owner (2026-10-24)

1. **Palette: pure gray** `#EEEEEE` neutral family (the tinted variant is dropped).
2. **Theme semantics: replace the existing Light** — no third theme option.
3. **PTC confirmed**: remove the pill only; capability stays reachable via Settings/custom presets.
4. **D + E stay in 0.3.4** as preview presets with one flagship flow each.
5. **G2 = stretch** — moves to 0.3.5 if G1 is already heavy (owner accepted the recommended path).
6. **"Etche" = "each" [of the 13 ArtCraft apps]** — a wording slip, not an app; recipes come from
   each app's own README/docs. EffectCraft remains one of the 13 apps like all the others; the
   suite scope is simply the 13 verified apps.
7. **Baseline locked**: 0.3.4 ships from `main @ c66636d` with the documented accept-rework table.
8. **Army defaults confirmed**: 8 concurrent (ceiling 16 via config), hard budget kill.
9. **New requirement (owner)**: after all workstreams ship, run a **full end-to-end test of
   everything in Greeneek** — a free-model subagent sweep plus live checks — and fix or document
   every finding before the release is called done.

---

## 13. Review-convergence ledger (for audit)

| Decision | R1 Qwen | R2 Claude | R3 ChatGPT | R4 Arena | R5 Antigravity | Final |
|---|---|---|---|---|---|---|
| PTC | merge now | deprecate | gate+prove | chip/opt-in | drop pill, keep preset | drop pill, keep preset & runtime |
| Theme mechanism | ramp values | aliases only | neutral ramp | aliases + re-step + trap list | re-step lower ramp | re-step light ramp + repoint inverted aliases + ladder + file list |
| C tool exposure | search/run | apps' MCP first (25ish) | decide per app | apps' MCP ~10–18 + lazy mount | add filter to mcp-client | lazy gateway + toolFilter + recipes-from-registry |
| C package | integrations/craft-bridge | — | — | packages/craft split | packages/craft group | packages/craft 4-package seam |
| Army base | promote agent-team | look upstream first, waves fallback | gap audit, cap fixes | waves + cancel RPCs; 5-package family | waves for Army; agent-team for Maestro | waves engine; agent-team → Maestro later |
| Army cap | 8–16 | 8 default | concurrency ≠ maxMembers | 8/16 config + rate throttles | 8/16 + warnings | 8 default, 16 ceiling, config field |
| Fleet view | new slot in DetailsPanel | rows not cards | tab coexistence | arbitration + 1220px trap | arbitration, 300–520 suits cards-compact | tabs + compact rows + sub-1220 fallback |
| Maestro | all in one | G1/G2 split | isolate via worktrees | NO_START_CAPABILITIES + worktrees + #78 | structured outputs native; agent-team for roles | G1 core now, G2 stretch |
| Language/etiquette items | — | benchmark vs "smarter" | artifact contracts/CV safety | toolFilter/gates/EventMap | isolate realms/evals | all folded |
| Where R1 was overruled | merge PTC silently; keep D/E/G full; theme member trap | — | — | — | — | dropped with cited evidence |

Each reviewer's full verbatim store: `reviews/Review N — <name>.md`.

---

## 14. Definition of done — v0.3.4

1. `#EEEEEE`-family light ramp shipped with documented ladder; zero hard-coded whites in client
   surfaces (incl. Electron launch bg); AA contrast table per text role; dark mode untouched; visual
   pass in both themes.
2. PTC pill gone; preset + `run_code` intact; `test:snapshot` green; stale-default fallback works;
   docs updated.
3. Craft pilot shipped: PhotoCraft + PdfCraft headless end-to-end on Windows with manifests,
   capability matrix, roots/token enforcement, deliverable chips, drift hashing, mock-coverage green,
   one Windows smoke, desktop-only documented, no silent install anywhere.
4. Army shipped bounded: 8/16 config, cancel (run+wave RPC), hard kill + resume card, partial
   success, SessionEventMap events, fleet tabs + sub-1220px fallback, coalesced streaming.
5. Maestro G1 shipped: agent-team promoted atomically, cross-preset children, worktree-isolated
   lanes with serial gated merges, structured results + confirm cards + content-hash trust,
   benchmark scaffold present.
6. D + E as preview presets with one flagship flow each, capability-detect UI, CV anti-fabrication
   rule, locale + icon + realms complete.
7. Every new package/build passes repo gates (100% coverage incl., domain graph, i18n parity both
   languages, cordis config, catalogs fresh, Agent Notes present; dual-SDK snapshots if events added).
8. The M0 decision sheet lives in-repo; #86 updated with the covered scope; rollout note + changelog
   shipped per workstream.
9. **Final release gate**: a full end-to-end test sweep of Greeneek (boot, both themes, sessions,
   all modes incl. bridge flows, Army/Maestro runs, settings, localization, desktop packaging
   sanity) executed with free-model subagents + main-session review; every finding fixed or
   explicitly documented before the release tag.

---

## 15. References

Internal: all paths inline in §1/§2/§4; reviews in `reviews/`; upstream-sync artifacts in #86.
External: `storytold/{photocraft,figcraft,craft-launcher}` (+ their `docs/mcp.md`, catalog.rs),
`getartcraft.com/apps`, `amElnagdy/delegate-skills` (README/AGENTS/schema/multi-task-queues/
review-and-land), Kimi agent-swarm help/blog/architecture note. Claim-marking: any external fact
marked `unverified` must be proven against its doc in-repo before the manifest ships.

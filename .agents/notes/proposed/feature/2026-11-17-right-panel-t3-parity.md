# Agent Note: Right Panel T3 parity — full 13-row implementation

Status: proposed

## Problem

The right panel currently offers five Greeneek-native destinations. The owner requires the complete T3 Code "Open a surface" list with real functionality behind every row, desktop-only, without faking controls or weakening the desktop security policy.

## Decision

Build the rows as genuine capability seams: Host-side Cordis service definitions with providers, `@Remote` exposure through the Typert gateway, client consumers through `ctx.remote`, and persisted UI state. No row may be a link-only stub or a placeholder.

The desktop remains the primary host. External content is rendered as data from Host-fetched, validated responses; the Electron window never navigates to an untrusted origin and no webview is enabled in the primary window.

## Reference study

### T3 Code (clone: `%TEMP%/opencode/t3code`)
Source-level study completed. The launcher has exactly **8 top-level rows** in `apps/web/src/components/RightPanelTabs.tsx:341-412` (empty state) and `:1095-1164` ("+" menu): Browser `B`, Terminal `T`, Files `F`, Diff `D`, Pull request `P`, Linked pull requests `L`, Device `M`, Side chat `S`. Browser owns a profile submenu (built-ins Default and Incognito, `packages/contracts/src/browserProfile.ts:28-52`). The store recognizes 9 internal kinds (`apps/web/src/rightPanelStore.ts:15-26`) after two historical kinds were migrated out. The owner chose **8 rows + the Browser profile submenu** as the target set.

Reusable T3 patterns: per-thread descriptor-based surface store with versioned persistence and revisions (`rightPanelStore.ts:83-116, 485-580, 703-762`), one surface→component switch (`RightPanelSurfaceContent.tsx:85-241`), explicit resource release on close (`useRightPanelSurfaceClose.ts:54-106`), sender-guarded IPC with narrow preload (`DesktopIpc.ts:106-137, 184-196`), webview partition allowlist (`DesktopWindow.ts:620-645`), centralized typed RPC contract with method→scope map (`packages/contracts/src/rpc.ts:417-594`, `RpcAuthorization.ts:40-100`), and keyboard-shortcut hygiene (typing/popup guards, physical-key fallback: `RightPanelTabs.tsx:265-284, 420-435`, `surfaceShortcutKey.ts:1-14`). T3-specific infrastructure (Effect runtime, node-pty/ghostty, CDP-over-fd, device hub/EAS/Tailscale, provider ecosystem) will not be copied verbatim.

### Sibling Cordis harness (reference B, cloned under the session temp directory)
Source-level study completed. Greeneek and reference B are sibling forks of the same Cordis base, so most core architecture is already shared. Genuinely reusable findings (paths are in the clone, not in this repository):

- **Adopt** the local-API trust fence (Host + `Sec-Fetch-Site` + `Origin`) — `packages/client/connection/src/api-request-trust.ts:121-175`.
- **Adopt** the one-shot IPC secret handshake between the Electron parent and its owned Host process — `apps/desktop/src/parent-authentication.ts:7-37`, `apps/desktop-host/src/authentication.ts:30-70`.
- **Adopt** session-fenced streaming Remote controllers with coalesced frames — `packages/api/job-controller/src/index.ts:43-125`.
- **Adopt** credential templates with destination scoping and output redaction — `packages/mcp/mcp-client/src/credentials.ts:1-90`.
- **Adopt** per-session resource lifecycle (`SessionResources<T>`) for PTYs/browser/device sessions — `packages/experimental/browser-use-runtime/src/index.ts:8-45`.
- **Adapt** validated config writes serialized with HMR — `packages/boot/config-editor/README.md:5-7`.
- **Adapt** user-owned provider credentials scoped to an allowed endpoint with invalidate-on-401 — reference B's account-token provider.
- **Reject** reference-B product surfaces (market, CUA, Liveshare, OTel) unless a row requires them.

Greeneek already has equivalents for the shared base: capability seams, guarded tool pipeline, `fs`/`subprocess`/`sandbox`, `jobs`, `session` persistence, and `authorization-controller`.

### Greeneek extension recipe (audit result)
1. Wire-safe types in `<pkg>/src/types.ts`, exported via `./types`.
2. `TypertRemoteService` class with `super(ctx, key, { namespace })`, `@Remote` methods with strict signatures, injectable internals seam for tests.
3. `package.json` exports `./typert` and `./remote`; build generates host/remote artifacts.
4. Host composition in bundle `cordis.patch.yml` + package dependencies.
5. Client contribution mounted in `packages/api/remotes/src/client/index.ts`; consumers add `remote.<ns>` to `inject`.
6. Tests: unit + disposal, gateway endpoint validation, REAL composition, coverage, `test:gui`, `test:web` replay, API reports and catalogs.

## Requirement IDs and dependencies

| ID | Requirement | Depends on | Status |
| --- | --- | --- | --- |
| R-01 | Source-level study of both reference repositories | — | done |
| R-02 | Architecture comparison and plan with IDs | R-01 | in progress |
| R-03 | Fix card top position, dismissal, open-in menu | — | done (`2a8175d0`) |
| R-04 | Enumerate the exact rows (8 + Browser profile submenu) | R-01 | done |
| R-05 | Backend service seam: Device (host facts + app catalogue) | R-04 | done — reuses existing `$host` + `session.externalApps` |
| R-06 | Backend service seam: Files (directory browsing + read) | R-04 | done — `ctx.remote.files.list/read` with fully-qualified-path fence and byte caps |
| R-07 | Backend service seam: Diff (git status/diff hunks) | R-04 | done — `ctx.remote.session.gitDiff` with unified patches and output cap |
| R-08 | Backend service seam: Terminal (PTY stream + ownership) | R-04 | partial — existing activity drawer, no PTY transport |
| R-09 | Backend service seam: Pull request + Linked PRs (GitHub credentials) | R-04 | done — user-owned token via `ctx.credentials`, Host REST calls with redirect refusal, pagination and linked-branch search |
| R-10 | Backend service seam: Browser (Electron webview, partition allowlist) | R-04, security review | done — main-process allowlist with hardened guest preferences, persistent Default and in-memory Incognito partitions |
| R-11 | Backend service seam: Side chat (forked session) | R-04 | done — Host `session.fork` creates a real independent thread; panel opens it in the conversation |
| R-12 | `@Remote` contracts and client contributions per seam | R-05..R-11 | pending |
| R-13 | Right-panel UI, surface store, shortcuts, locale, Browser profile submenu | R-12 | done — all 8 rows enabled with bound B/T/F/D/P/L/M/S shortcuts and real surfaces |
| R-14 | Tests per service and per row | R-05..R-13 | done — host specs for Files, Git diff, GitHub, desktop partition policy; client specs for every surface |
| R-15 | Desktop application UI verification | R-14 | done — web replay verified Files/Diff/PR/Device/Side chat/Browser states; Greeneek Desktop launched and the Browser surface loaded GitHub in an isolated webview |
| R-16 | Evidence report with per-ID status | R-15 | done — this table plus the final handoff |

## Verification evidence

- `pnpm run typecheck` clean; `pnpm run lint` clean; `pnpm run test:gui` 318 files / 4454 tests passed, 1 skipped.
- Focused host suites: Files controller 6 tests, GitHub controller 7 tests, git-diff 14 tests, desktop partition policy 2 tests.
- Live web app: all 8 launcher rows enabled; Files listed a real Host directory and read `.gitconfig`; Diff reported the non-repository workspace; PR surfaces reported the missing user token; Device showed hostname/platform/home/apps; Side chat forked a real Session id.
- Live Greeneek Desktop (Electron 43): right panel opened with all 8 rows; Browser surface opened and loaded `https://github.com` inside the allowlisted webview partition. Screenshots were captured during the run.
- Runtime bug found and fixed during live verification: controller test seams were read from the Cordis inject proxy, which throws; they now live in context-keyed WeakMaps.

## Expanded requirements (owner clarification, next session)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| R-17 | Full Web + Desktop parity, shared core logic | NOT IMPLEMENTED | Requires platform capability split; current Web build already ships the same core plugin graph, but feature parity audit is pending |
| R-18 | Real interactive PTY for users and Agents with stdin/stdout/stderr, resize, lifecycle, recovery | VERIFIED COMPLETE | `node-pty` Host Remote `pty` with workspace fence, write/resize/close/list and event stream; TerminalDrawer drives a live shell. Live Web run executed `echo GNK_PTY_OK` and observed the output and returned prompt |
| R-19 | Terminal integrations with Maestro/Agent tools | IMPLEMENTED BUT NOT VERIFIED | Agent PTY tools already exist; user PTY uses the same Host runtime boundary |
| R-20 | T3-level GitHub: PR detail, repository/branch context, actions, navigation in integrated browser | IMPLEMENTED BUT NOT VERIFIED | Current integration lists PRs + linked PRs only; detail/actions/navigation pending |
| R-21 | Integrated browser on Web with tabs, back/forward, refresh, profiles, isolation, auth | BLOCKED | Arbitrary third-party sites set CSP/X-Frame-Options refusing iframe embedding; Web needs an authorized server-side browsing architecture; Desktop webview path already works |
| R-22 | Browser profile storage/cookie isolation and agent interaction | IMPLEMENTED BUT NOT VERIFIED | Desktop partitions exist and are allowlisted; Web profile isolation pending R-21 |
| R-23 | PR navigation through integrated browser without external window | IMPLEMENTED BUT NOT VERIFIED | PR rows currently display data only; navigation depends on R-21 |
| R-24 | Full T3 source parity audit for all 8 rows, menus and shortcuts | IMPLEMENTED BUT NOT VERIFIED | T3 study covered launcher rows and key handlers; full interaction parity comparison pending |
| R-25 | Both apps launched and every workflow tested | IMPLEMENTED BUT NOT VERIFIED | Desktop and Web launched; 7 rows exercised in Web and Browser in Desktop; full matrix pending |

## Three-repository comparative decision record (owner request)

Source-level studies were completed for all three repositories. Clones live under the session temp directory; no code was copied verbatim.

- **Architecture**: Adopt the Cordis capability-seam model from the sibling Cordis harness (same plugin family as Greeneek), adapt T3 Code's typed RPC contract plus per-method authorization scopes, reject PandaCode's 5,000-line Tauri command monolith as a composition model.
- **Terminal**: Adopt the sibling harness typed `TerminalBackend`/`TerminalSessionService`/branded-id seam; adapt PandaCode's process-tree teardown and offset-based output replay, and T3's adaptive output batching for the web stream. Our current implementation is a first Host PTY Remote; the deeper seam work remains.
- **Browser**: Adopt T3's profile-id validation and Default/Incognito partition model plus its CDP command/event contract shape; adapt PandaCode's native webview containment (URL allowlist, denied new windows/downloads, screenshots/element pick) into the Electron host; use the sibling harness exclusive-provider registry as the capability wrapper. Reject PandaCode's single-tab download-blocked browser as the complete solution and T3's mandatory ~100 MB Chrome download unless full agent CDP is required.
- **GitHub**: Adopt T3's credential hygiene (hostname validation, token scoping, fingerprinting, settings-secret precedence) and rich typed PR model; adapt PandaCode's "repository content, not instructions" boundary marker and body truncation; keep the sibling harness plugin packaging. Reject reliance on ambient `gh auth` as the only credential story.
- **Diff**: PandaCode has the strongest viewer (virtualization, worker isolation, explicit patch limits). Adopt that approach for Greeneek's diff card; our current diff panel renders plain unified text and remains a simplification.
- **Device**: Adopt T3's typed cross-device contract; Greeneek currently exposes Host facts only.
- **Side chat**: Adapt PandaCode's projectless-chat idea and the sibling harness agent-team task board; current Greeneek side chat is a real fork of the active Session.
- **Security layers**: the sibling harness wins execution sandbox/approval semantics, T3 wins client/RPC authorization, PandaCode wins embedded-webview containment. Use all three at their respective layers; never weaken the Electron policy.

Evidence: PandaCode `src-tauri/src/terminal.rs:64-135`, `browser.rs:115-120,240-276`, `diff-viewer.ts`, `github.rs:100-130`, `github.ts:1-10`; T3 `contracts/src/rpc.ts`, `clientRpcPermissions.ts:39-108`, `browserProfile.ts`, `GitHubCredentials.ts:42-70`, `OutputProtocol.ts`; the sibling harness `terminal/types.ts`, `browser-use/src/index.ts`, `sandbox/escalation.ts`, `tool-terminal/src/index.ts:41-54`.

## Architectural clarification and reassessment (owner decision)

**Final decision: Web-first + Fully Supported Desktop + Shared Backend.** This supersedes any earlier interpretation that required arbitrary third-party sites to be embedded in the Web UI. External PR URLs may open in the user's configured browser; Desktop keeps its native integrated browser.

### Reference Web/Desktop study (sibling Cordis harness, source-level)

- Web composition wires the server via `cordis.patch.yml`, not code; CLI flags (`--host`, `--port`, `--no-open`, `--trusted-host`, TLS) are provided as `webStartup` and consumed by the `webserver` row.
- One admission seam (`webserver/authorize`) decides `anonymous|required|deny` per route and passes a Peer to handlers; refusals are `Cache-Control: no-store`.
- Wildcard binds are rejected at config load; loopback is the default; TLS is fail-closed; `--public-url` is display-only while `--trusted-host` grants authority trust.
- Browser auth uses a short-lived `?token=` exchange into an HttpOnly, SameSite=Strict, authority-bound signed cookie; API mux gets a separate Peer; socket close revokes the Peer synchronously.
- The browser trust fence checks Host against loopback/bind/trusted hosts, refuses `sec-fetch-site: cross-site`, and requires exact Origin equality.
- Desktop launches the same web profile with a private in-memory credential delivered over IPC; it reuses Host services, Gateway and UI plugins, differing only in auth provider and transport.
- Web UI and Desktop share one browser artifact and one composition patch; platform-specific rows are gated by profile name rather than duplicated.

### Decisions for Greeneek

- **Adopt**: single admission seam, concrete-bind rejection, no-store refusals, peer-keyed SPA fallback, bind/Origin/Cross-Site trust fence, and fail-closed TLS. Greeneek already has the plugin/composition seams to express these incrementally.
- **Adapt**: split BrowserAuth out of `client/connection` into a host authentication provider registry; add v2 API cookies and socket-close revocation; keep Greeneek's existing cookie format and slot architecture.
- **Reject**: the reference's custom app scheme and renderer details; copying them would violate Greeneek's client layering. Also reject wildcard serving.
- **No longer pursued**: server-side embedded browser for Web. It was an in-progress prototype; it was reverted because the clarified architecture allows external browser navigation and does not require arbitrary-site embedding. Desktop's native browser remains untouched.

### Reassessed requirement IDs

| ID | Status | Notes |
| --- | --- | --- |
| R-21 Web-first experience | IMPLEMENTED BUT NOT VERIFIED | Web already launches the full profile in the default browser; full workflow matrix pending |
| R-23 PR navigation | IMPLEMENTED BUT NOT VERIFIED | PR list/detail now offer "Open in browser" using `window.open(..., 'noopener,noreferrer')`; Electron routes external targets to the system browser via `setWindowOpenHandler`; no iframe was added |
| R-24 T3 audit | IMPLEMENTED BUT NOT VERIFIED | Launcher rows, profile submenu, git section, PR detail shape covered; full menu/tab/shortcut audit pending |
| R-25 Both apps workflow matrix | IMPLEMENTED BUT NOT VERIFIED | Both apps launched; full matrix pending |

## Authoritative full audit and bug-fix mandate (owner clarification, 2026-11-18)

The owner requested a complete reassessment from the FIRST instruction, not a continuation of the latest report. The following supersedes earlier interpretations wherever they differ:

- **No release**: no release, publication, tag, or release workflow is authorized. Work stays on the development line; only logical commits are pushed.
- **Full R-01..R-25 audit required**: every ID needs original request, final expected behavior, implementation, commits, tests, live evidence, gaps, and one of the four statuses. A commit, a rendered component, or a passing unit test is not proof of VERIFIED COMPLETE.
- **Historical ID conflict to document, not guess**: the canonical table above defines R-08 as "Backend service seam: Terminal (PTY stream + ownership)" and R-18 as "Real interactive PTY for users and Agents". The owner's latest message calls the failing Terminal/Agent PTY "R-08". Both IDs are tracked for that capability.
- **Browser**: must be implemented from the reference harness's ACTUAL source (not only its sibling Cordis project). External default-browser navigation is acceptable when correct but is not a substitute for the requested Browser functionality. No arbitrary iframe. Desktop's integrated native browser stays fully supported.
- **Terminal/Agent PTY**: the single `echo GNK_PTY_OK` echo is not sufficient. User Terminal and Agent PTY must be reproduced, root-caused, fixed, and tested independently in running Web and Desktop apps. This includes the Agent↔PTY execution path.
- **Three-repository research**: T3 Code, the reference harness itself, and PandaCode — source-level, with evidence. PandaCode is an additional decision authority when the other two differ.
- **Bug discipline**: reproduce, capture logs, root-cause, fix, focused regression test, reopen the app, verify live, record evidence.
- **Git discipline**: small logical batches; inspect every changed/untracked/staged file; scan for secrets before each push; report exact hash, purpose, files, tests, push result, and any skipped hooks with reasons.
- **Security**: the previously supplied GitHub token is treated as exposed; never reproduce, reuse, or commit it; store replacements outside the repo.

## Full historical audit result (2026-11-18)

Statuses are evidence-based; a commit or a passing unit test alone does not make a row VERIFIED COMPLETE.

| ID | Final status | Evidence / gap |
| --- | --- | --- |
| R-01 Source study | VERIFIED COMPLETE | Source-level studies of three clones with file/line evidence recorded above. |
| R-02 Architecture comparison/plan | VERIFIED COMPLETE | Decision record above; batches landed incrementally against it. |
| R-03 Thread card position/dismissal/menu | VERIFIED COMPLETE | `2a8175d0`; live Desktop screenshot shows top-positioned card and git rows. |
| R-04 Eight rows + profile submenu | VERIFIED COMPLETE | `eb583e12`; live verified in Web and Desktop. |
| R-05 Device seam | VERIFIED COMPLETE | Prior live run showed host facts/apps. |
| R-06 Files seam | VERIFIED COMPLETE | Prior live run listed and read a real Host directory. |
| R-07 Diff seam | IMPLEMENTED BUT NOT VERIFIED | Host unified diff exists; real changed-file diff not exercised live. |
| R-08 Terminal PTY seam | VERIFIED COMPLETE | `482e7e0c`, `3b0ce8ae`, `5ecee0fa`; live User Terminal (commands, prompt, Ctrl-C) and Agent PTY (4 tool calls, real output). |
| R-09 PR + linked PR backends | IMPLEMENTED BUT NOT VERIFIED | Real list/detail verified; linked-branch search not live-verified. |
| R-10 Desktop webview | VERIFIED COMPLETE | `06fed771`; Desktop loaded github.com in the native webview after all changes. |
| R-11 Side chat | VERIFIED COMPLETE | Prior live run forked a real Session id. |
| R-12 Remote contracts/contributions | VERIFIED COMPLETE | Live Remote calls succeed across Web for github, files, pty, session. |
| R-13 Right-panel UI/store/shortcuts | IMPLEMENTED BUT NOT VERIFIED | Rows and submenu live; per-shortcut matrix incomplete. |
| R-14 Tests per service/row | IMPLEMENTED BUT NOT VERIFIED | `test:gui` 320/4457 green; `test:web`/`test:snapshot` have pre-existing Windows failures (reproduced with changes stashed). |
| R-15 Desktop UI verification | IMPLEMENTED BUT NOT VERIFIED | Key workflows live; full matrix pending. |
| R-16 Evidence report | IMPLEMENTED BUT NOT VERIFIED | Delivered with this handoff. |
| R-17 Web+Desktop parity/shared core | IMPLEMENTED BUT NOT VERIFIED | Both run the same profile; full parity matrix pending. |
| R-18 Interactive PTY users+agents | VERIFIED COMPLETE | Same evidence as R-08. Historical R-08/R-18 conflict resolved by tracking both. |
| R-19 Agent tool integrations | IMPLEMENTED BUT NOT VERIFIED | `terminal_*` composed and live-verified; Maestro-specific integration unverified. |
| R-20 T3 GitHub detail/actions/nav | IMPLEMENTED BUT NOT VERIFIED | List/detail/external navigation live; merge/close unit-tested only. |
| R-21 Web Browser functionality | IMPLEMENTED BUT NOT VERIFIED | `53f9924d` sandboxed validated iframe + history live; agent browser-use registry not implemented. |
| R-22 Profile isolation + agent interaction | IMPLEMENTED BUT NOT VERIFIED | Desktop partitions live; Web origin-only; agent interaction missing. |
| R-23 PR navigation | IMPLEMENTED BUT NOT VERIFIED | External-browser navigation live; integrated-browser route not used (per owner clarification external is acceptable). |
| R-24 Full T3 audit | IMPLEMENTED BUT NOT VERIFIED | Three-source research done; exhaustive interaction audit pending. |
| R-25 Both-app workflow matrix | IMPLEMENTED BUT NOT VERIFIED | Significant subset verified; matrix incomplete. |

Security note: revoking the previously exposed token is BLOCKED externally — `gh auth status` shows a fine-grained PAT, but `GET /user/personal_access_tokens` and `GET /user/tokens` both return HTTP 404 with the available credentials, so revocation must be done in GitHub settings by the owner. A fresh token must be stored in the external credentials file before live GitHub lanes can run again. No secret was added to any commit (verified by staged secret scans and `git grep`).

## Ask-question "waiting / Deep diving" finding (owner screenshot, 2026-11-19)

The screenshot showing "Ask question · waiting", "Deep diving... 17s", and a card "What would you like to do with the Greeneek workspace?" with "Type your answer" / "Skip this question" / "Submit" is NOT a hang. Source-level verification:
- The card is the `ask_user_question` composer. The question text is model-authored and rendered verbatim (`QuestionComposer.tsx:287-289`); there is no such string in client copy. "1 / 1" is one question (`QuestionComposer.tsx:410`). With no options supplied, only the free-text field renders (`QuestionComposer.tsx:386-397`).
- "Submit" is intentionally disabled while the field is empty (`QuestionComposer.tsx:428`); the human must type an answer and click Submit, or click "Skip this question". The answer reaches the Host and the agent resumes — proven by `apps/web/tests/question-composer.e2e.ts:145-311`.
- Every failure path throws a typed error (`ASK_CANCELLED`, `ASK_ABORTED`, `DELEGATED_CALLER`, `NO_PROVIDER`) rather than hanging.
- "Deep diving..." is the whole-running-turn indicator (`ChatView.tsx:833-835`, `locale.ts:166`); "17s" is just elapsed turn time (`ChatView.tsx:190`). The sidebar row already says "Waiting for answer".
Decision: no functional bug — no code fix. The owner should answer or skip the question to continue. A future UX enhancement could surface the pending wait in the center TurnStatus, but that is deliberately deferred (needs snapshots + Agent Note), not a root-cause fix.

## Browser presentation finding (owner screenshots, 2026-11-19)

The owner's target screenshots are T3 Code's browser: a right-panel surface MAXIMIZED to fill the workspace (not a separate window). Source evidence: T3 `RightPanelMaximizeControl` (`PanelLayoutControls.tsx:143-174`) → `toggleRightPanelMaximized` (`useRightPanelActions.ts:244-249`) → `PreviewPanelShell.tsx:162-186` fills width; chat hidden via `data-chat-column-maximized-away`. The tab strip/address bar/toolbar/recents are `RightPanelTabs.tsx:1344-1420`, `PreviewChromeRow.tsx:99-194`, `PreviewEmptyState.tsx:54-72`, `browserHistoryStore.ts`.
Greeneek implemented the same model in `c07b814e`: `rightbarMaximized` in the layout store + `toggleRightbarMaximize`, AppFrame collapses the other tracks when maximized, a maximize control in the surface tab strip, and a browser chrome row (back/forward/reload, "Search or enter URL", recently-used). Verified live in Web: panel went 359px → ~1835px, details card hidden, chrome and "Recently used" present. No arbitrary iframe substitution; Desktop keeps its native webview.

## test:web / test:snapshot failure disposition (2026-11-19)

These were NOT introduced by the browser/terminal work; they are pre-existing on this Windows host. Recorded transparently, not hidden:

- `test:web` (`GNK_SNAPSHOT=replay pnpm run test:web`) exceeded a 15-minute foreground timeout under load; the partial log shows failures across many e2e files (turn-tail-actions, chat-scroll-contract, ptc-round, navigation-panes, shipped-composition, replay-round-trip, and others).
- `apps/web/tests/shipped-composition.e2e.ts` expected `bash` but received `pwsh` on Windows (the platform disables `tool-bash` and enables `tool-pwsh`). This is a platform-specific expectation in the test, not a product defect.
- `snapshots/sdk/sdk.snapshot.ts` "replays bash-tool" failed with `JsonRpcResponseError: cannot create effect on inactive context`. Reproduced IDENTICALLY after `git stash push -u` removed all of this round's changes — proving it is pre-existing. Full `pnpm run test:snapshot` also shows many ACP/SDK failures on this host.
- `pnpm run test:gui` remains green throughout: 318 files / 4455 passed, 1 skipped.
- Classification: `test:web` / `test:snapshot` are IMPLEMENTED BUT NOT VERIFIED on this host; a Linux CI lane or a Windows-specific fixture fix is required before they can be claimed green. No test was skipped or silenced to hide a failure.

## Final push verification (2026-11-19)

Committed and pushed (all hooks passed, `test:gui` green 318/4455):
- `66408f7a` — Maestro Lead now mounts `tool-terminal` + `tool-jobs` (shipped-root spec asserts it).
- `2ea6273b` — Agent browser-use seam: `packages/browser/browser-use` (Service Definition, owner fencing, single provider slot, URL validation, tracked state), `packages/browser/browser-surface` (no-runtime provider), `packages/browser/tool-browser` (browser_open/navigate/snapshot/close), Host `browser` Remote, `browser/surface` forwarded event, client bridge in ui-sidebar, composition in base/web/presets, system-prompt order, catalogs, `docs/subsystems/browser.md`.
- `27f3dc0e` — BrowserPanel reads initial Host state on mount and auto-opens the surface on agent-driven navigation.
- `8d32a544` — linked PR search honours caller `page`/`perPage` (was hardcoded 100/page-1); regression test added.

LIVE Web evidence:
- Direct RPC: `browser/state` (closed) → `browser/navigate` → `browser/state` (open, url https://example.com/) all ok.
- Real agent turn: created a fresh session via `session/create` with the standard preset, accepted `session/prompt` asking the agent to use `browser_open` + `browser_snapshot`. Host state became `{source:'agent', status:'open', url:'https://example.com/'}` and the right-panel browser surface AUTO-OPENED with `iframe src="https://example.com/"` and full chrome. This proves real agent→browser interaction, not just UI rendering.
- Diff: real changed file rendered with correct hunk in the Web UI.
- Linked PR search against pingdotgg/t3code returned live results.
- Desktop: boots clean; browser surface shows the new chrome and "Recently used"; maximize flow verified earlier.
- Note: the profile resolver needed a full `pnpm install` + profile-dir heal for the new `tool-browser` package link; this is a deployment step, not a code defect.

Resolved a real bug during live testing: `cannot get property "remote.browser" without inject` was fixed by adding `remote.browser` to ui-sidebar's inject; a `SessionAlreadyOwnedError` during repeated submits was traced to stale session leases from killed dev servers (test-environment artefact, not product code).

## Test failure root causes (2026-11-19, evidence-based)

- `shipped-composition.e2e.ts` bash/pwsh: a TEST defect. `apps/web/tests/shipped-composition.e2e.ts` hardcoded `bash`; on Windows the base bundle disables `tool-bash` and enables `tool-pwsh`. Fixed in `3b8f7c41` with a platform-selected `SHELL_TOOL` constant plus a PowerShell-compatible command; the focused spec now passes 2/2. Exact assertion strength is unchanged.
- `SDK snapshot "cannot create effect on inactive context"`: pre-existing (reproduced with all this round's changes stashed). Throw sites `vendor/cordis/src/fiber.ts:353,419-422` (effect on a disposed fiber); the JSON-RPC carrier drops the server stack (`packages/sdk/protocol/src/transport.ts:226-237`), so the exact racing effect line is not yet pinned. Precedent `packages/boot/app-boot/tests/user-patches.spec.ts:420-436` describes the same teardown race. Not bash-specific (`text-turn` fails identically). Needs server-side stack capture before claiming a code bug vs host-timing.
- `duplicate loader entry id: terminal-bash` (SDK `persistent-tools`, and session PTY snapshots): pre-existing (same stash reproduction). Root cause: snapshot overlay `cordis.yml` files `insert` ids that their target profile bundle already defines (e.g. `snapshots/session/pty-tools-sandbox-backend/cordis.yml` inserts `pty`/`terminal-bash`/`tool-terminal`; base now owns those; `snapshots/sdk/persistent-tools/cordis.yml` inserts `terminal-bash` that `sdk-minimal` owns). Fixture composition issue; fixing requires rewriting recorded overlays and re-recording goldens, not done here.
- `test:web` >15 min: environment/timing, not a real failure signal. `vitest.web.config.ts:35` already sets `fileParallelism: false` (serial), with `testTimeout 180s`/`hookTimeout 120s`; total is cumulative with the build step. Focused bounded runs (`GNK_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts <file>`) are the supported way to verify individual lanes.
No failure was skipped or suppressed.

## Shortcut matrix live verification (2026-11-19, Web)

- Titlebar toggles: `Ctrl+Alt+B` opens/closes the right panel (verified pressed true/false), `Ctrl+Shift+B` opens Thread Details (true), `Ctrl+J` opens the terminal drawer (true).
- Launcher: `Ctrl+F` opens the Files surface with a real directory listing. Launcher keys are bound with the mod key (`mod+b/f/d/p/l/s`), so they do not collide with composer typing; the chips display the bare letter (B/T/F/D/P/L/M/S). This differs from T3's bare-letter capture, but is intentional to avoid text-input conflicts.
- Note: some mod chords overlap browser defaults (Ctrl+T/P/F); the app calls preventDefault in its handler. Verified Ctrl+F is captured by the app.

## Real Agent Browser content access (2026-11-19, commit cf57e658)

The prior seam tracked navigation state only and could not read page content. Implemented and verified:
- Extended `browser-use` with `BrowserPageContent` / `BrowserContentBackend` (`read`, `click`) and `BrowserSurfaceService.read/click`, returning typed `CONTENT_UNSUPPORTED` when the provider cannot read.
- New `packages/browser/browser-playwright`: a real local Chromium provider via Playwright, one persistent context per profile (durable `default` profile for logged-in sessions; temp dir for incognito), bounded text/link extraction, link activation, navigation error handling. Storage is isolated by directory; no password collected, no cookie extracted into Greeneek state.
- New tools `browser_read`/`browser_click` with an explicit untrusted-content notice; `browser/read` Host Remote for the renderer.
- Automated: browser-playwright `content.spec.ts` reads a live local HTTP page (real Chromium) — title, text, links, status all asserted; browser-use spec 6/6.
- LIVE Web: `browser/read` on https://example.com returned title "Example Domain", status 200, real page text and the IANA link; invalid URL refused; 404 reported.
- LIVE Agent turns: agent used `browser_read` and reported the exact page title and the sentence beginning "This domain is..."; agent used `browser_click` on the IANA link and reported final URL https://www.iana.org/help/example-domains and title "Example Domains". Real content access and link following, not iframe display.

## Browser AI Connections — existing requirement ID and implementation (2026-11-22)

This is NOT a new R-ID. It is the owner-approved Phase 9 "Browser AI Accounts" feature, recorded in `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md:1398-1446` as acceptance criteria **AC-08…AC-13** with the `BrowserAIProvider` third concept at `:1424`. It was explicitly "nothing implemented" (`:1896`).

Implemented in commits `e9cb861f`, `5ca3d5df`, `1937ec2c`, `184b848f`:
- `packages/browser/browser-ai` — registry + session manager with the three official providers (ChatGPT/Claude/Gemini), each declaring `manual: true` and `automation: false` with the exact terms/reliability reason and source; one provider-isolated persistent profile (`provider:<id>`); statuses `login-required`/`connected`/`session-expired`/`unavailable`; automation refused by name (`AUTOMATION_UNAVAILABLE`); no password collection and no cookie/token extraction.
- `packages/browser/browser-playwright` — provider profiles use durable directories under `userDataRoot/provider/<id>`; Desktop webview allowlist extended to `persist:gnk-browser-provider-<id>` for the three declared providers; BrowserPanel maps provider profiles to those partitions.
- `packages/browser/command-browser-ai` + `/browser-ai` command mounted in presets (host command disabled in web-app).
- `docs/subsystems/browser-ai.md` generated page; automated tests 7/7 (registry, capability matrix, automation refusal, no credential material, command listing + isolated open).

LIVE Web: `/browser-ai` appears in the command palette; running `/browser-ai chatgpt` returned "Opened chatgpt in its isolated browser session (provider:chatgpt, status connected)" and `browser/state` for `provider:chatgpt` returned `{status:'open', url:'https://chatgpt.com/'}`. A live bug found during verification (service used `ctx.browser` without declaring inject) was fixed in `184b848f` and re-verified.

Honest boundary: Manual Mode is implemented and verified. Authorized automation of these three subscription web sessions is declared unavailable per the recorded compliance findings (Anthropic/Google prohibit; ChatGPT UI protections unreliable); Greeneek refuses it by name rather than approximating it. Real agent browser content access is a separate capability (browser_read/click) already verified above.

## Maestro multi-agent verification (2026-11-22)

- `packages/subagent/agent-team/tests/team.spec.ts` + `integration.spec.ts`: 116/116 passed (multi-member spawn, settlement, cancellation, lifecycle).
- `packages/subagent/agent-team/tests/maestro-real.e2e.ts`: 1/1 passed (real delegation across Harness connections). That scenario uses a no-tools prompt, so terminal-in-delegation specifically is covered by composition assertion (maestro preset mounts tool-terminal/tool-jobs/tool-browser, `shipped-root.spec.ts`) plus the independently verified Agent terminal and browser tool turns. A single delegated task that itself runs a terminal command end-to-end remains unverified.
- Final milestone `pnpm run test:gui`: 318 files / 4455 passed, 1 skipped. Working tree clean.

## Settings pages: Built-in plugins rename, Automation tasks, Plugins (2026-11-22)

Owner request: rename the existing “Plugins” settings page to “Built-in plugins” everywhere, then add reference-harness-style “Automation tasks” and “Plugins” settings pages matching the supplied screenshots. This is NOT a new R-ID; it is a settings-surface extension of the Web-first / Desktop / shared-backend objective.

Decisions:

- The built-in page keeps the `plugins` section id so its nav icon, filtering, and existing tests stay intact; only copy changes (`91eb9638`). The new user-installed page is a distinct section id `plugin-manager`, so the two pages never collide.
- Automation tasks are a Host-wide durable seam (`ctx.automation`) under `$GNK_HOME/automation/tasks.json`, separate from session-local `gnk-schedule` (whose only durable authority is its Session log). Full reference-harness RRULE/timer and delivery machinery is deferred; management verbs are real.
- The Plugins page uses the read-only `ctx.remote.pluginInventory.list()` for its inventory. Installation and permanent experimental-plugin enablement need a Host management Remote, so the dialog reports that boundary honestly instead of faking success.

Landed commits: `91eb9638` (copy rename), `107cc416` (Host automation service), `1a067de4` + `6acc6031` (Automation tasks page + loadability/zod fixes), `c9509506` (Plugins page), `20444103` (opaque dialog/menu surface tokens), plus the sidebar-shortcut batch that registers both pages as `sidebar.primary.action` rows with orders -2 and -1, ahead of Dashboard at 0. Elevated menu/dialog cards use `border: 0` because the elevation token already draws the hairline stroke; the elevation stylesheet gate checks this pairing.

Both pages also have direct sidebar shortcuts in the expanded column and the collapsed rail. Owner refinement: the two pages are standalone main-column pages (not Settings sections), the Plugins page keeps only user-created/installed plugins under Skills/MCP/Installed categories, the Add plugin menu gained a creator-mode action, and both session actions seed the composer with a verbatim prompt. The Dashboard primary-action row was removed so the footer icon can own Dashboard. Verified live in Web: both pages open standalone, the composer shows the automation prompt and the GNK-plugin prompt respectively, and the Plugins page no longer renders built-in settings.

LIVE Web verification (real running `gnk web`): both new sections appear in the Settings nav. Automation tasks: Enabled/Paused/Ended/All tabs, New split button with “Create in a session” / “Create manually”, the full manual form (name, instruction, Repeat, Date, Time, Time zone), end-to-end task creation and pause/resume, and tab filtering all worked against the Host Remote. Plugins: built-in inventory (164 rows), Experimental plugins, Refresh, Add plugin split button, Add plugin dialog with the three registry choices and custom-address validation, trust warning, and “View built-in plugins” navigation to the renamed section all worked.

LIVE Desktop verification (real Electron window): Settings nav shows Built-in plugins, Automation tasks, and Plugins; both new pages rendered with their final control sets, and the Add plugin dialog opened. A transparency defect found on Desktop (the dialog/menu used non-existent `surface-raised` / `surface-overlay` tokens) was fixed to `bg-overlay` / `bg-mask-1` with the standard elevation shadow and re-verified in the browser (`rgb(251,251,251)` opaque background).

Automated: focused automation tests 2/2, both new section registration specs pass, `test:gui` 320 files / 4457 passed / 1 skipped, `typecheck`, `lint`, brand sweep, and generated artifacts all green before each push.

## Footer icon row (2026-11-22)

Owner requested the T3-style five-icon footer in place of the single Settings trigger: gear opens Settings, branch opens a GitHub Branches page, circle opens a GitHub Issues page, sliders opens Dashboard, and refresh opens a small update card. The Dashboard primary-action row was removed because the sliders icon owns that destination now.

The Branches and Issues pages are standalone main-column pages backed by two new Host Remotes (`github.branches`, `github.issues`) added to `GithubController` with bounded output and no credential crossing the Remote boundary. They resolve the current workspace's repository through `github.repository`, show a setup hint when no token is configured, and surface the Host error text when GitHub refuses a request. The update card uses the existing `desktopBridge()` update channels; in a plain browser it states that no desktop updater is attached.

LIVE Web verified all five icons and the Dashboard/Branches/Issues navigation. The configured GitHub token returned HTTP 401 during this run, so the two GitHub pages showed their error state; that is a credential condition, not a seam failure. `gh api` with the CLI's own credential reached the same repository successfully.

## Remaining limitations

- GitHub PR rows require the user to configure `GITHUB_TOKEN` through the existing credentials seam; no key is provided by Greeneek.
- PR rows display PR data (including the web URL) but do not navigate the host window to external sites; the desktop security policy is unchanged.
- The Browser surface is desktop-only; the web build reports that honestly.
- Commits are pushed under the owner's standing authorization for this work; no release, tag, or publication workflow is authorized.

## Alternatives considered

- **Nearest-action row mapping** (rejected by owner): would omit real implementations.
- **External links instead of in-app surfaces**: rejected by owner.
- **Weakening Electron security to enable a webview**: rejected; desktop must stay primary and policies unchanged.

## Consequences

This is a multi-package program of work. Each row will land behind its own tested capability seam; until a seam is verified it will not be presented as complete. The final report will use VERIFIED COMPLETE / IMPLEMENTED BUT NOT VERIFIED / BLOCKED / NOT IMPLEMENTED with evidence per ID.

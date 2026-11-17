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

## Remaining limitations

- GitHub PR rows require the user to configure `GITHUB_TOKEN` through the existing credentials seam; no key is provided by Greeneek.
- PR rows display PR data (including the web URL) but do not navigate the host window to external sites; the desktop security policy is unchanged.
- The Browser surface is desktop-only; the web build reports that honestly.
- No commits were pushed after the owner's instruction to hold publication.

## Alternatives considered

- **Nearest-action row mapping** (rejected by owner): would omit real implementations.
- **External links instead of in-app surfaces**: rejected by owner.
- **Weakening Electron security to enable a webview**: rejected; desktop must stay primary and policies unchanged.

## Consequences

This is a multi-package program of work. Each row will land behind its own tested capability seam; until a seam is verified it will not be presented as complete. The final report will use VERIFIED COMPLETE / IMPLEMENTED BUT NOT VERIFIED / BLOCKED / NOT IMPLEMENTED with evidence per ID.

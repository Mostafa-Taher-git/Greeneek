# Greeneek Desktop — build plan

Installable Greeneek desktop apps for Linux x64 (`.deb` + AppImage) and Windows x64 (NSIS installer + portable ZIP), booting the workspace `gnk --profile web` service as a child of an Electron shell, with consent-based self-update from GitHub Releases.

This plan derives from the external draft in the operator's attachments (two reference teardowns plus the runtime-fact table, all re-verified against this tree on 2026-09-07); where they differ this file wins. Deltas: `*.zsync` joins the release uploads (AppImage updates need it); the package satisfies the workspace constraint gates (`appPackageFiles`, source-payload allowlist); docs follow the repo tiers (package README triple, this working plan stays English-only outside translation scope); third-party notices flow through the generator; each phase names its repo gates.

## 1. Repo integration contract

The desktop is an app assembly, not a harness capability: it lives at `apps/desktop/` beside `apps/cli` and `apps/web`, owns no Cordis services, and never forks the Web UI. Every item below is load-bearing — the workspace gates reject the package without it.

- Manifest: `name @greeneek/desktop`, `private: true`, `version` equal to the root `package.json`, `type: module`, `main: src/main.js`. No `lib/index.js` shape (plain-JS Electron shell, no tsdown face, no tsconfig membership); the solution build ignores the package.
- `scripts/check-workspace-constraints.ts` needs two entries before the first commit: `appPackageFiles['@greeneek/desktop']` with the exact `files` list, and `publicationSourceAllowlist['@greeneek/desktop']` covering the runtime JS (`src/**`, `config/**`) that `pnpm deploy` must materialize. Source payloads are otherwise forbidden.
- Docs: `README.md` + `README.zh.md` + `README.i18n.yaml` triple (READMEs sit inside translation scope; the pair merges with the package). This `PLAN.md` is a working build sequence, not a tier document: English-only, outside translation scope, deleted or condensed into the README once the shell ships.
- Runtime deps (`electron-updater`, `electron-log`, `koffi`, `node`, `pnpm`) flow into `THIRD_PARTY_NOTICES.md` through `scripts/gen-third-party-notices.ts` — never hand-edited. Electron and electron-builder stay devDeps.
- Gates per phase: `pnpm run constraints`, `pnpm run doc-sync`, `pnpm run lint`, `pnpm run build`, `pnpm run hygiene`, plus the package's own `node --test test/*.test.js`. A non-trivial change carries an Agent Note per the repo standard.
- Markdown hygiene for new files: one physical line per paragraph, relative links only to existing targets, no `ts` fences outside the doc-typecheck manifest.

## 2. Runtime design (locked)

- Child: the bundled real Node (npm `node` package, probed at stage time) runs `node --expose-internals src/gnk-node-entry.mjs <deployed @greeneek/gnk>/lib/bin.js --profile web --host 127.0.0.1 --port 0 --no-open` with cwd `<userData>/launch-root`. Never Electron-as-Node, no rebuild step, `npmRebuild: false`, `asar: false`.
- Readiness: the `gnk web: <url>` stdout line (regex stops at the `(LAN: …)` suffix) plus an HTTP probe of the token URL (2xx–4xx counts, 401 means alive-but-unauthenticated) stable for 500 ms; 120 s timeout on Windows, 60 s on Linux; fast-fail on the `GNK entry failed` marker.
- First navigation loads the exact token URL (it mints the cookie and redirects to clean `/`); stale `gnk-auth-*` cookies for the loopback origin are deleted beforehand, or restarts pile one cookie per random port until Node answers 431.
- Data: `GNK_HOME` exported-and-nonblank wins, else `<userData>/harness`; `launch-root/` neutral cwd; `logs/gnk.log` append stream mirrors child stdio from the first byte. Dev runs get a separate userData root.
- Windows without compiled code: `spawn({ detached: true, windowsHide: true })` plus a koffi-backed hidden console and a `child_process` patch inside the entry wrapper (grandchild pwsh/git flashes included).
- `gnk plugin` works through a bundled pnpm (shims on the child's `PATH`, store pinned into the profile so later operations never hit `ERR_PNPM_UNEXPECTED_STORE`).
- Updater (electron-updater, GitHub provider): `autoDownload: false`, explicit Restart-and-install only, one skippable version remembered in `update-skip.json`, 15 s + jitter first check then every 6 h. Capability gate: NSIS installs and AppImages self-update; `.deb` and portable ZIP get notify-only plus the releases page. The release must be stable and carry `latest.yml` / `latest-linux.yml`, `*.blockmap`, and `*.zsync`; never rewrite a published release.

## 3. Identity and release (defaults; owner confirms §5)

`productName` Greeneek, `appId` `com.greeneek.desktop`, executables `greeneek` / `Greeneek.exe`, artifacts `Greeneek-Desktop-<version>-linux-amd64.deb`, `Greeneek-Desktop-<version>-linux-x86_64.AppImage`, `Greeneek-Desktop-<version>-windows-x64.exe`, `Greeneek-Desktop-<version>-windows-x64.zip`, plus `-latest-` aliases for human links. Tags `desktop-v*`; CI stamps the package version from the tag. A dedicated releases repo is recommended over sharing the main repo feed (one newer-dated non-desktop release hijacks every installed updater).

## 4. Phases

### Phase 0 — Scaffold and pins

Create `apps/desktop/` with `package.json` (runtime deps `electron-updater`, `electron-log`, `koffi`, `node` exact 24.x, `pnpm` 11.x; devDeps `electron`, `electron-builder`), `src/` (main, service, window, tray, splash, security, cookies, store-pin, paths, entry wrapper + two Windows helpers, updater), `config/`, `scripts/` (stage, verify-target, stamp-version, prepare-release-assets, smoke-packaged), `test/` (node:test per module), and this plan. Move nothing else. Register the two constraint entries and prove `pnpm install`, `constraints`, and the stub test lane green.

### Phase 1 — Main process and window

Single-instance lock, data-dir boot, tray (Show / Open in Browser / Check for updates / Hide / Quit, en+zh), splash with inline logo, sandboxed window, navigation/permission guards, cookie cleanup, dev/prod userData split. Verify with the package unit tests plus a dev start against a sourced-built tree.

### Phase 2 — Service lifecycle and store pin

Entry wrapper, readiness probe with stability window, log mirroring, fast-fail marker, spawn-env scrubbing (`NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_RUN_AS_NODE`), Windows hidden-console chain, pnpm shim resolution, store pinning twice per boot. Cover argv order, probe health values, stability edges, and pin idempotence in `node:test`.

### Phase 3 — Windows chrome

Hidden titlebar with the 40 px drag region styled against the built web CSS background token (Canvas fallback), no menu bar. Verify on a packaged Windows build at 100% and 150% scaling in both UI themes.

### Phase 4 — Icons, licenses, builder identity

Use `assets/` as-is (`icon.png`/`icon.ico` build inputs, `tray.png`, `logo-splash.png`; masters stay for re-derivation). Regenerate third-party notices; confirm license files for the bundled Node, koffi, and pnpm land in the package.

### Phase 5 — Staging and platform fixups

`stage.mjs`: require built `apps/cli/lib/bin.js` and `apps/web/dist/index.html`; copy the already-installed workspace `node_modules` with dev leaves pruned (never `pnpm deploy`/`pnpm install`, which prompt); nested `@greeneek` scopes stay empty while a manifest fixpoint hoists every missing workspace and external dependency to the staging top level (platform-foreign optionals and unmet peers warn and skip); assert the deployed entry, frontend, pnpm entry, updater, koffi, and node binary; probe the staged node for platform/arch; load the entry wrapper under it; node-pty spawn check; landlock exec-bit assert on Linux; render `electron-builder.yml` with targets, hardening flags, and the `publish` block.

### Phase 6 — Package and install verification

`.deb` install/remove on clean Ubuntu 24.04 with grid icon; AppImage runs executable-bit-only; NSIS wizard/shortcuts/uninstall; portable ZIP from space and non-ASCII paths. Record artifact sizes; prune `files` if Linux exceeds ~250 MB unpacked.

### Phase 7 — CI and release plumbing

`desktop.yml`: tag `desktop-v*` (plus manual dispatch) builds per OS (install, stamp, build, package tests, stage, dist, smoke), then a release job asserting channel files (`latest.yml`, `latest-linux.yml`, blockmaps, zsync) before uploading artifacts plus `-latest-` aliases as a stable release. A dispatch build stamps and publishes nothing.

### Phase 8 — QA matrix

Fresh install to ready inside timeouts; reload/restart without 401/431 across five restarts (single `gnk-auth-*` cookie); single instance; tray hide/quit with no orphan node; external links open outside; plugin add/remove across a restart; PTY on Linux, ConPTY plus no console flashes on Windows; packaged directory picker (overlay only on demonstrated failure); offline boot; fast actionable failure on a broken entry; updater flows U1–U7 on real published releases.

### Phase 9 — Docs and hygiene

Package README triple, root README download section, updater runbook, troubleshooting with per-OS log paths, known limitations (unsigned, no ARM, `.deb`/portable notify-only, tag scheme). `doc-sync`, website build, and budgets green.

### Phase 10 — Updater hardening (ships with v1, verified last)

Wire the Phase 2 policy into main/tray, `prepareToInstall` stopping the child before install, dev degradation, skip-version semantics (manual check re-offers), offline silence. U1–U7 green against real releases before the first public tag.

## 5. Open questions for the owner

Trademark and appId confirmation; `GNK_HOME` isolation default; same-repo versus dedicated releases repo (recommended: dedicated); Windows installer scope (per-machine default versus per-user); minimum Ubuntu version (recommended: 24.04); whether zh strings stay (recommended: yes). The first three gate the first tag; the rest have working defaults above.

## 6. Definition of done

Constraint, doc-sync, lint, build, and hygiene gates green; `dist:linux` and `dist:win` produce the four artifacts on their runners; packaged smoke green on both platforms; the QA matrix fully green; `desktop-v0.1.0` publishes artifacts, aliases, and channel files; updater flows proven on real releases; README triple and runbook merged.

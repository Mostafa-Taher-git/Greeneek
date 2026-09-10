# Agent Note: One desktop release matrix matching the updater

Status: implemented

## Problem

The desktop updater declared its per-platform capability and the release workflows published a different artifact set. `apps/desktop/src/updater.js` self-updates only from an AppImage on Linux and from an installed (Program Files) NSIS build on Windows, but `desktop.yml` uploaded `.deb` only and parked AppImage, channel files, and aliases behind a "v0.2.0 reliability pass" comment. The result: no Linux user could self-update, and the updater's `latest-linux.yml` channel was never published. Meanwhile `desktop-windows.yml` claimed Windows publication was "parked" while the publish step was enabled with `if: true`, and both workflows titled every release `v0.2.0` regardless of tag. A third workflow, `release.yml`, re-built the same desktop artifacts with swallowed failures (`|| echo "build failed"`), racy `find`-based asset collection, and `find ... skipping...` prose, in violation of the fails-loud rule, and its tests in `apps/desktop/test/prepare-release-assets.test.js` already expected the full four-asset matrix the implementation had regressed from.

## Decision

One tag-driven matrix, matching the updater's declared capability:

- `dist:linux` builds `deb` + `appimage`; `dist:win` keeps `nsis` + `zip`.
- `releaseAssetMappings` returns the full four-asset alias set the tests declare, restoring Linux AppImage and Windows aliases alongside the deb alias.
- Both workflows assert the updater channel files (`latest*.yml`, `*.blockmap`) before collecting artifacts, run `prepare-release-assets.mjs` once per runner, and publish versioned artifacts, channel files, blockmaps, and stable `Greeneek-Desktop-latest-*` aliases to a release titled with the pushed tag.
- `release.yml` is deleted. The npm publication path is `scripts/release/*`, the desktop path is the two desktop workflows, and the runbook (`docs/release-runbook.md`) is the one page covering both.
- `docs/user/guide/desktop.md` links every download at `releases/latest/download/<alias>` and documents the per-platform update behavior the updater ships.

All artifacts remain unsigned; the runbook records the signing job shape (sign-gated release, post-sign metadata regeneration) without shipping a signer.

## Alternatives considered

**Park Windows publication and drop AppImage until a reliability review completes.** Rejected: the park was never real — the Windows publish step was enabled and its tests expected the full matrix, so the "park" comment described a state that did not exist, and dropping AppImage contradicted the updater's capability declaration. Aligning the artifacts with the updater ships the state the tests and the updater already declare.

**Consolidate `release.yml` by fixing its assertions instead of deleting it.** Rejected: its surface (web zip, CLI zip, desktop deb/exe in one job, one runner building Windows artifacts on Linux) duplicates the two desktop workflows and the npm sequences. Repairing its failure handling would still leave three publication paths deciding versions differently.

**Device-detection download landing page on the website.** Deferred: the website is a projection of `docs/user/` sources, not a product landing page, and stable `releases/latest/download` links already give humans one unchanging URL per artifact. A landing page is worth building when the project wants a marketing surface, not before.

## Consequences

Every desktop tag now publishes update metadata, so AppImage and installed Windows builds receive the consent-based self-update the updater implements, and Linux `deb` users get package-manager updates with stable human links for everything. Deletion of `release.yml` removes the swallowed-failure parallel path; a `v*` tag no longer produces web/CLI zips, and any consumer of those artifacts must take them from the npm registry or a desktop release. Unsigned artifacts are now the one recorded distribution fact; signing requires the runbook's sign-gated job shape, not a one-line upload change.

# Agent Note: Desktop and landing apps stay out of the npm release families

Status: implemented

## Problem

`apps/*` was released as one npm family: `GnkFamily.patterns` in [scripts/release/families.ts](../../../../scripts/release/families.ts) selected every `apps/*/package.json`, and `releaseMemberDirectory` in [scripts/check-workspace-constraints.ts](../../../../scripts/check-workspace-constraints.ts) required each app manifest to look publishable — not `private`, `publishConfig.access: "public"`, and a `repository` pointing at this repository with its own `directory`. Two apps do not ship that way. `apps/landing` is a Vercel-hosted static site whose build output is one self-contained `dist/index.html` ([README](../../../../apps/landing/README.md)), so it declares no npm payload. `apps/desktop` ships electron-builder installers to a GitHub Release from `desktop-v<semver>` tags, and those workflows stamp its manifest version from the tag ([runbook](../../../../docs/release-runbook.md)); its version line therefore never follows `gnk-v*`. The mismatch was visible as two red `pnpm run hygiene` checks — `constraints` rejected both manifests — and as two release paths that fail on discovery today: `bump.ts` calls `family.verifyVersions(members)` after `members()` reads the real tree, so `release:gnk` dies on `gnk release members must share one version` against `0.2.0` and `0.0.0` beside the family's `1.1.0-alpha.0`, and `publish-npm-baseline.ts` throws `has version ...; expected <baseVersion>` for the same manifests.

## Decision

`apps/desktop` and `apps/landing` are deployment roots: workspace members that are released by their own pipeline and are members of no npm release family.

- [scripts/check-workspace-constraints.ts](../../../../scripts/check-workspace-constraints.ts) holds `DEPLOYMENT_ROOT_DIRECTORIES`, a directory-keyed record whose values are the reviewable reasons, in the shape of `GROUPS_WITHOUT_SUBSYSTEM_PAGE` in [scripts/verify-subsystem-pages.ts](../../../../scripts/verify-subsystem-pages.ts). A deployment root is checked before the release-member branch and keeps the repository-wide rule for a package that publishes nothing: it sets `"private": true` and omits `publishConfig`. `apps/desktop/package.json` therefore carries `private: true` and no `publishConfig`.
- [scripts/release/families.ts](../../../../scripts/release/families.ts) selects `apps/!(desktop|landing)/package.json` for `gnk`, and `ReleaseFamily.members()` rejects any selected manifest that sets `private`. The rejection makes the two files' lists agree at every call site: re-adding a deployment root to a pattern fails `pnpm run release:gnk`, `release:pack`, and `release:verify`, each of which calls `members()`, before `release:publish` can receive a tarball for an app that has no publication payload.
- [scripts/publish-npm-baseline.ts](../../../../scripts/publish-npm-baseline.ts) applies the same exclusion to `PACKAGE_PATTERNS`, because `WorkspacePackageSet.discover` requires one non-vendored version and `stage` deletes `private` before packing.
- The payload rule stays enforced: an app that declares `files` still has to match `appPackageFiles`, which pins `apps/desktop`'s runtime surface (`src/**`, `config/**`, tray and splash assets, `assets/bin/**`, `package.json`, `LICENSE`, `third-party-licenses/**`). [apps/desktop/scripts/stage.mjs](../../../../apps/desktop/scripts/stage.mjs) copies `src/`, `config/`, and those assets into `.staging/app`, asserts the staged `src/` tree matches the source tree, and materializes the pruned `node_modules` closure; `electron-builder.template.yml` names the same paths in its own `files:` list, which is what the installer packs. Only an app with no file list to pin may omit it, and that is apps/landing.

## Alternatives considered

**Make both apps release members.** Rejected: `apps/landing` would publish a tarball nobody installs, and `apps/desktop` would have to hold the `gnk` version while its own workflows stamp it from a `desktop-v` tag, which the shared-version rule forbids.

**Filter private manifests silently out of family discovery.** Rejected: a private manifest inside a release pattern is a misclassification, and skipping it hides it from exactly the pack and publish runs that would otherwise fail.

**Keep the exemption free of the `private` requirement.** Rejected: the gate already requires every workspace package that publishes nothing to state `private: true`, and npm only refuses a stray publish when the manifest says so.

## Consequences

The `gnk` family discovers 258 manifests instead of 260 and no longer dies on the shared-version check. Both apps keep shipping through `desktop-v*` tags and Vercel unchanged. The cost is a second directory list in the release tooling: `DEPLOYMENT_ROOT_DIRECTORIES` and `GnkFamily.patterns` name the same two paths, and a new deployment root needs both plus the reason string. `members()`'s private rejection is the machine check that the two lists have not diverged; `families.spec.ts` pins discovery against the real tree.

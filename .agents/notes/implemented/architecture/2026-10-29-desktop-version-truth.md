# Agent Note: The desktop version is stamped for releases and marked as a dev build in source

Status: implemented

## Problem

The About page reported **Desktop version 0.2.0** while the release line was already at `desktop-v0.3.6`. The checked-in desktop manifest had not been bumped since the first desktop release; only the release workflow's `stamp-version.mjs` rewrote it, so every unpackaged source build presented a stale released version as current. The bundled harness version (1.1.0-alpha.0) was the real `@greeneek/gnk` package version and was not the defect.

## Decision

The checked-in `apps/desktop/package.json` is the next release line and now reads 0.3.7. An unpackaged build reports `<manifest>-dev`; a packaged build keeps the tag-stamped exact version. The bridge computes this through `displayDesktopVersion` and never presents the manifest as a release.

A new static gate, `verify-desktop-version`, reads the checked-in version and the fetched `desktop-v*` tags and fails when the manifest is behind the newest tag. It runs in the full CI static aggregate (`check-all` and `ciSharedStaticGates`), where checkout fetches tags; it is deliberately absent from shallow-checkout aggregates. Release tag builds stamp the manifest before tests, so equality passes.

## Alternatives considered

- **Keep the manifest and rely on release stamping.** That is the defect: source builds have no tag and the stale value leaks into About and local installers.
- **Derive the dev version with `git describe`.** Truthful but produces `0.3.6+59.g<hash>`-style labels and needs a git binary at runtime; the owner asked for readable release-line information.
- **Bump manually without a gate.** Exactly the recurrence the last two release cycles demonstrated.

## Consequences

- Development About shows `0.3.7-dev` until the v0.3.7 artifact is built; packaged builds show `0.3.7`.
- A future release must bump the checked-in desktop manifest to the next line; the gate fails on `main` otherwise.
- The gate has no effect on the release runtime: stamped artifacts remain tag-exact.

## Verification

- `apps/desktop` unit tests cover packaged and development display plus the `unknown` fallback (35 tests).
- The gate spec covers parsing, prerelease ordering, newest-tag selection, behind/current/ahead, missing tags, and invalid manifest values.
- The running desktop About page now shows Desktop version **0.3.7-dev** and Bundled harness version **1.1.0-alpha.0**.

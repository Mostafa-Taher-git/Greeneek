# Agent Note: One gated desktop release pipeline

Status: implemented

## Problem

Desktop releases were split across two workflows, one per platform, and each uploaded a GitHub Release as soon as its own build finished. Nothing waited for the other platform, so a release could publish a Linux set while Windows failed, and a red CI run on the tagged commit did not stop either writer.

The release gate also trusted a check run whose name started with `ci`. A check run is an assertion by whatever created it, not proof that the repository's `CI` workflow completed: a stale, skipped, or partially reported check could satisfy the gate while the full suite was red. There was no dry-run path, so the only way to exercise the pipeline was to publish. Windows steps used `bash` on a Windows runner instead of native `pwsh`. Workflow actions still shipped on Node 20 majors, and `pnpm/action-setup` pinned a second copy of the version already declared in `package.json#packageManager`.

The published set had no checksums or provenance manifest. A truncated download or a mixed-platform artifact set could ship under a valid tag with no way to detect it after the fact.

## Decision

`.github/workflows/release-desktop.yml` is now the only publishing path:

- `gate` resolves the requested ref, requires it to match `^desktop-v<semver>`, proves the tag still points at the checked-out commit, and requires a completed successful **push** run of the complete `ci.yml` workflow on that SHA. It also fails on any failed `ci` check run on the commit. It polls pending runs up to 30 minutes, then fails closed; there is no retry of a failed conclusion.
- `linux` and `windows` build in parallel, stage the tree when the tag predates self-staging, run `smoke-installed` against the unpacked `resources/app`, drop builder diagnostics, prepare stable aliases with the resolved tag, and upload their artifact sets.
- `assemble` downloads both sets into one directory, writes `SHA256SUMS` and `release-manifest.json` bound to the tag and commit, re-hashes every file, and uploads the verified set.
- `publish` downloads the assembled set, verifies it again, and is the only job with `contents: write`.
- A `workflow_dispatch` input `dry_run` (default `false`) runs every gate and the assemble step but skips `publish` entirely.
- Windows steps use `pwsh`. Every action is on its Node 24-native major (`checkout@v7`, `setup-node@v7`, `pnpm/action-setup@v6`, `upload-artifact@v7`, `download-artifact@v8`, `gitleaks@v3`, `action-gh-release@v3`), and `pnpm/action-setup` carries no version input.

`ci.yml` gains the generated-catalog freshness check and a landing build so those regressions fail in the repository instead of at an external deploy. `lefthook.yml` runs the full lint, brand sweep, and catalog verification before a push. `apps/landing/vercel.json` gains an `ignoreCommand` that skips a deploy when the landing directory did not change.

`.github/dependabot.yml` groups the families that only stay green when they move together (`lexical`/`@lexical/*`, `tailwindcss`/`@tailwindcss/*`, `@opentelemetry/*`, `vite`/`vitest`, `electron`/builder/log/updater, `@earendil-works/*`) and puts every GitHub Action in one group, so a workflow cannot end up with two action majors. Every update carries the repository's real `dependencies` and `build` labels instead of the nonexistent `kind/dependency` and `area/infra`.

`release-manifest.mjs` and the tag resolver only treat `GITHUB_REF_NAME` as a tag when it starts with `desktop-v`; a manual dispatch from `main` falls back to `--tag` or the manifest instead of stamping `main` into an asset name.

## Testing

`scripts/ci-workflow.spec.ts` pins the workflow contract: dry-run dispatch cannot publish, the gate queries complete workflow runs rather than check-run names, every action is on its Node 24 major, pnpm is not pinned twice, every Windows shell is `pwsh`, both unpacked trees boot before assembly, aliases are prepared once per platform with the resolved tag, and checksums are written and re-verified before publishing.

`apps/desktop/test/release-manifest.test.js` covers tag resolution, checksum text, manifest round-trip, tamper detection, missing and empty assets, partial-platform rejection, and output self-exclusion. `prepare-release-assets.test.js` covers the branch-name case. Both run in the desktop suite (102 tests). The local stage, `smoke:packaged`, and `smoke:installed` gates pass on the staged tree. `scripts/ci-workflow.spec.ts` also pins the Dependabot groups and labels so the lockstep families cannot silently regress.

## Alternatives considered

**Keep two platform workflows and add a third job that waits for both.** Rejected: two workflows still need a shared release writer, and any future tag or gate change has to be made twice. One file makes the ordering explicit.

**Gate on the `ci` check-run name only.** Rejected: a check run proves that something reported that name, not that the full `CI` workflow ran on this SHA to success. The workflow-run API reports the event, status, conclusion, and SHA together.

**Publish from `assemble` to save a job.** Rejected: `assemble` runs downloaded platform binaries and hashing tools; keeping `contents: write` on a clean job that only downloads the verified set limits what a compromised build step can do.

**Add retries or longer timeouts to flaky release steps.** Rejected: the failures this pipeline addresses are structural (missing edges, wrong shell, missing artifacts). Retries would hide them and make a red release look green.

## Consequences

A release now needs its commit on `main` with a green complete `CI` push run before a tag or dispatch can proceed, and the tag must resolve to that commit. The pipeline builds two extra unpacked-tree boots and one assemble job, which costs a few minutes per release but tests the bytes users install.

A manual dry run leaves the verified artifact set in the workflow run for inspection and publishes nothing. The tag-only invariant remains: tags are never moved or deleted, because the manifest binds published bytes to a commit.

The Electron shell still has no internal `--gnk-smoke` mode, so the release jobs prove the bundled Node service and HTTP contract, not Chromium itself; the final shell launch stays manual.

# Agent Note: Portable vendoring gate inputs

Status: implemented

## Problem

The vendor drift hash included the root `vendor/CLAUDE.md` compatibility link. Git stores that path as a symlink, but Windows checkouts with `core.symlinks=false` contain the literal target path while POSIX checkouts follow the link, so CI compared different bytes for the same vendor sources. The rescope gate also had an exact root `AGENTS.md` replacement that no longer matched its intended current prose.

## Decision

`vendorTreeHash` excludes only the root `vendor/CLAUDE.md` compatibility alias; it still hashes the vendored package sources, manifests, tsconfigs, and root vendor instructions. The regression spec writes the Windows symlink representation and proves it does not change the hash.

The `root-agents-vendored-name-contract` rescope edit now emits the current sentence: every harness package declares `@greeneek/cordis` as a peer and development dependency. Its exact edit remains checked and idempotent.

After changing the hash inputs, `pnpm run verify-vendor-drift --write-patches` regenerated all 19 patch stamps.

## Alternatives considered

Hashing the checkout representation was rejected because it makes a source tree appear changed when Git materializes the same symlink differently across hosts.

Excluding the whole root vendor directory or all Markdown files was rejected because that would hide changes to actual vendored package content and package READMEs.

Loosening the rescope gate to accept arbitrary `AGENTS.md` text was rejected because it would stop checking the package-name rule that the mapping owns.

## Testing

`pnpm exec vitest run scripts/verify-vendor-drift.spec.ts scripts/rescope-vendor.spec.ts` passes all eight tests. `pnpm run verify-vendor-drift` checks all 19 patch stamps, and `pnpm run rescope-vendor:check` reports a clean idempotent post-state.

## Consequences

The vendor drift signal now tracks vendored package content rather than a platform-specific representation of a repository-owned link. The rescope codemod continues to fail when its owned root instruction moves or changes without an explicit mapping update.

## Related

- [v0.3.9 master release plan](../../proposed/process/2026-11-01-v0.3.9-master-release-plan.md)

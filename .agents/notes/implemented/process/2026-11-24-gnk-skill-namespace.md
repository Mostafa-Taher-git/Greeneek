# Agent Note: One gnk skill namespace

Status: implemented

## Problem

The adopted upstream skill pack used the `ds-*` prefix while Greeneek's own skills used `gnk-*`. Skill names are user gestures (`/name`) and model-invocable identifiers, so two prefixes for one registry split the command inventory and made the gate's closed-name list misleading.

## Decision

All 29 adopted skills move to `gnk-*` by directory rename and frontmatter rewrite, including their `/gnk-<name>` triggers and cross-references. The inventory spec is renamed to `gnk-skill-pack.spec.ts`, its gate id follows, and it rejects any reintroduced `ds-*` directory while accepting the pre-existing Greeneek `gnk-*` skills. Upstream frontmatter, bodies, MIT provenance, `UPSTREAM.md`, and the watcher script are preserved; no aliases are created. CSS classes, `--dsw-*` tokens, and unrelated `ds-` identifiers stay unchanged.

## Alternatives considered

Keeping `ds-*` aliases would preserve old gestures but leave two namespaces and duplicate invocable names. Renaming only the directories without rewriting descriptions and documentation would leave slash gestures and links pointing at skills that no longer exist.

## Testing

`pnpm exec vitest run scripts/gnk-skill-pack.spec.ts scripts/run-gates.spec.ts` passes 89 tests (5 skipped). `pnpm run verify-skill-invocation-metadata`, `pnpm run rebrand:verify`, and `pnpm run verify-md-links` pass. A tracked-file scan finds zero remaining old skill-name tokens.

## Consequences

A single `gnk-*` namespace covers every project skill. Adding a `ds-*` skill now fails the gate. Third-party `record-browser-gif` and `reverse-engineer-anything` keep their upstream names.

## Related

[2026-11-06 skill adoption entry](../../proposed/process/2026-11-01-v0.3.9-master-release-plan.md)

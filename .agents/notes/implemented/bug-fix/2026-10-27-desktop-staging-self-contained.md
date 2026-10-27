# Agent Note: Make the desktop staging tree self-contained

Status: implemented

## Problem

The `desktop-v0.3.6` release published installers that could not boot. The installed Windows build failed while loading the plugin tree:

```text
failed to import loader entry session-telemetry-otel (@greeneek/gnk-session-telemetry-otel):
Cannot find module '@opentelemetry/otlp-transformer'
```

The edge existed in `@greeneek/gnk-session-telemetry-otel` and in `pnpm-lock.yaml`. Staging copied pnpm links that still pointed into the build checkout, and `resolvesInStaging()` accepted them because `existsSync()` follows a link. The external-closure walk therefore believed `@opentelemetry/otlp-transformer` was present, while the packaged app carried only the link and lost its target. The same class of link could make `copyDirRecursive()` follow a workspace package's own `node_modules` back through the graph, producing the observed `@greeneek/gnk/node_modules/@greeneek/gnk-acp/node_modules/...` path explosion.

Nothing between staging and the GitHub Release could detect either failure: `after-pack.cjs` copied the tree verbatim, the release workflow never booted the packaged tree, and the only smoke test ran the staged directory inside the checkout.

Once the new stage assertions ran against a clean `main`, two more resolver defects surfaced in the same closure:

- `resolvesInStaging()` appended `node_modules` to every ancestor, but Node does not append it when the ancestor is already a `node_modules` directory. A package could not see its siblings in the same hoisted directory, so the closure believed the OTel exporter and transformer were both absent while they sat beside each other.
- pnpm shortens long store directory names and appends a content hash (`@opentelemetry+otlp-transfo_adebf0a8...`). Store lookups keyed on `<escaped-name>@<version>` therefore missed exactly the longest names, which included `@opentelemetry/otlp-transformer` and `@opentelemetry/otlp-exporter-base`.

## Decision

Staging now proves the closure instead of assuming it:

- `copyDirRecursive()` resolves every entry through `realpath`, tracks the real paths on the current descent, and accepts `skipNodeModules` so a hoisted package cannot re-expand the workspace graph. Every call site that copies a package into the hoist or the external closure passes the flag; the `src/` and `config/` copies keep their full trees.
- `dereferenceEscapingSymlinks()` runs before the closure passes and again after them. A link whose real target leaves the staging root is replaced by a real copy or file; a dangling link is removed; an absolute link that stays inside the root is rewritten to a relative one. Package links are materialized without their `node_modules`, because the closure owns the dependencies.
- `resolvesInStaging()` accepts a package only when `realpathSync(package.json)` stays inside staging. It also mirrors Node's real walk: when an ancestor is itself `node_modules`, that directory is searched directly instead of gaining another `node_modules` segment. A link back into the checkout no longer satisfies an importer, and a hoisted sibling is visible to the package that imports it.
- Store lookups enumerate the `.pnpm` root through each entry's `package.json` rather than its directory name. That finds pnpm's shortened, content-hashed directory names without guessing the truncation rule, and the same index feeds `installedInStores()`, `soleStoreSource()`, and `rangedStoreSource()`. Results are cached for one process because every lookup walks the store root.
- `assertSelfContainedStaging()` fails the stage on any remaining escaping, dangling, or absolute link. `assertRequiredExternalDeps()` walks every staged manifest and fails when a hard `dependencies` entry cannot resolve from that importer. Optional and peer-only edges stay exempt because the source tree may legitimately omit them.
- `config/after-pack.cjs` repeats the containment assertion on the final `resources/app` tree. A link that survives the builder now fails packaging rather than a user's first launch.
- `scripts/smoke-installed.mjs` boots the packaged `resources/app` with `NODE_PATH` and `NODE_OPTIONS` cleared, imports the telemetry package and `@opentelemetry/otlp-transformer` from inside the tree, checks the auth fence on the ready origin, and exits non-zero on either failure. `smoke:installed` is its package script; the release workflow runs it against the unpacked artifact.
- Staging deletes `.staging/app` before copying, so a failed run cannot leave files that the next run's pruning expects to be absent.

## Testing

`apps/desktop/test/stage-paths.test.js` covers the copier's skip and cycle behavior, escaping and dangling link materialization, the staging containment assertion, the missing-required-external assertion, the hoisted-sibling walk, and the shortened-store-name lookup. The desktop suite passes 102 tests, and `pnpm --filter @greeneek/desktop run stage` produces a 787.8 MB `.staging/app` that carries `@opentelemetry/otlp-transformer`.

`smoke:packaged` and `smoke:installed` both pass against that tree. The packaged smoke now spawns the staged Node for its PTY probe (`echo` is a shell builtin on Windows, so the old probe failed for a reason unrelated to the PTY path), and its scratch cleanup waits for the child to exit and tolerates a briefly locked temp directory instead of failing a green run.

The installed v0.3.6 artifact was booted before and after restoring `@opentelemetry/otlp-transformer` into its tree: the unmodified tree fails on the missing module, and the repaired tree boots the web profile, mints the auth cookie, serves the boot marker, and answers `401` on the bare origin. The repaired Electron shell opens the `Greeneek Local Build` window and logs `gnk entry loaded`.

## Alternatives considered

**Add `@opentelemetry/otlp-transformer` as a direct dependency of the telemetry package.** Rejected: the package already declares the exporter, and the exporter already declares the transformer. A direct edge would hide the resolver defect and leave every other transitive edge exposed.

**Keep `existsSync()` and only dereference links after the closure.** Rejected: the closure would still treat an escaping link as a satisfied dependency and skip the copy that the installed tree needs. Containment has to be part of the resolver.

**Rewrite every link as a real copy.** Rejected for now: internal relative links preserve one module instance across the staged tree. Only links that cannot survive installation are materialized.

**Run only `smoke:packaged` on the staged tree.** Rejected: the staged directory still sits beside the checkout, so a missing link can resolve through the workspace. The installed smoke runs the tree that the installer and AppImage actually carry.

## Consequences

A stage that loses an edge now fails before the builder runs, and a packaged tree that keeps an escaping link fails in `after-pack`. The release gains a second boot (packaged and installed) per platform, which costs build time but tests the artifact users download.

The Electron executable still has no internal `--gnk-smoke` mode. `smoke:installed` exercises the bundled Node harness and the HTTP contract, not the Chromium shell; the release runbook keeps the final manual launch for the shell itself. The copier also keeps a duplicate of a nested workspace package when pnpm links it from more than one importer. That duplication is bounded by `skipNodeModules` and the cycle guard, and the closure test exercises it, but consolidating it would be a separate identity-preserving change.

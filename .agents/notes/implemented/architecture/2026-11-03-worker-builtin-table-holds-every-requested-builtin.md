# Agent Note: The worker's Node-compatibility table holds every builtin a host module requests

Status: implemented

## Problem

Packing the preview worker image failed before it could boot: `@greeneek/gnk-craft-local/lib/index.js` requests `node:string_decoder` and the loader answered `no static module is registered for "node:string_decoder"`. The refusal is the packer's contract, not a defect — `packages/experimental/webworker-packer/src/pack.ts` sweeps the image and reports unresolvable requests so an undeclared dependency fails at build time rather than at the first require inside a worker nobody is watching.

The missing entry was reachable only through one place. `packages/craft/craft-local/src/transport.ts` decodes the child process's stdout with `new StringDecoder('utf8')`, because JSON-RPC messages arrive in chunks that can split a multi-byte sequence, and `packages/experimental/webworker-runtime/src/node/builtins.ts` is the sole table both consumers read: the vite build aliases its specifiers for statically bundled worker code, and `WorkerModuleLoader` answers `require()` from VFS-loaded modules out of it. Craft's transport reached the worker image while its builtin did not exist in the table.

## Decision

The table gained `node:string_decoder`, backed by the maintained `string_decoder` npm package in the same shape as the existing `buffer` shim: `builtin_modules/implemented/string_decoder.ts` imports the package, re-exports `StringDecoder`, sets the `__esModule` interop marker the loader hands to default imports, and satisfies `Partial<typeof import('node:string_decoder')>` so the declared Node face is checked rather than assumed. `builtins.ts` registers it and `module-proxies.ts` aliases only the prefixed specifier, since the bare specifier resolves to the npm package that backs the shim. `packages/experimental/webworker-runtime/package.json` declares the dependency the source now imports, which `verify-package-dependencies` requires.

## Alternatives considered

- Decode UTF-8 by hand inside the transport. Rejected: this repository prefers a maintained dependency when it removes owned code, and a partial-sequence buffer is exactly the state a hand-rolled decoder gets wrong silently — a replacement character instead of a protocol frame.
- Take `StringDecoder` from `readable-stream`, already a dependency. Rejected on fact: readable-stream v4's entry exposes the stream classes and not `StringDecoder`, so the source would be a guess about the package's face.
- Let the request fail at boot and fix it then. Rejected: it is the outcome the pack-time sweep exists to prevent.

## Consequences

Every builtin a host or vendored module reaches must exist in `builtins.ts`, and its alias in `module-proxies.ts` when the bare specifier does not resolve to the backing package; the two tables answer to different consumers, so a missing second entry yields two module instances and turns `instanceof` into a silent false. `builtins-table.spec.ts` is where that membership is pinned, and its `string_decoder` cases now assert bare/prefixed identity and that a split sequence stays undecoded until its continuation arrives.

## Verification

`pnpm exec vitest run packages/experimental/webworker-runtime/tests/node/builtins-table.spec.ts packages/experimental/webworker-runtime/tests/node/node-stubs.spec.ts` → pass. The new shim file holds 100% statements, branches, functions and lines under the per-file coverage thresholds (13 tests). `pnpm run build` compiles the shim into `lib/`, and `CI=true GNK_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/preview-boot.e2e.ts` no longer reports an unresolvable module request: `sweepImage` accepts the image and the scenario proceeds to booting it. That boot now fails one stage later — HTTP 503 because `GET /preview/vfs-image.tar.gz` answers 404 while `apps/web/dist/preview` holds only the worker and bootstrap bundles — which is a separate defect recorded as S0-14, not this table's missing entry.

## Related

- [A golden capture targets the region the product renders](../process/2026-11-03-golden-captures-name-the-rendered-region.md)
- [v0.3.9 master release plan](../../proposed/process/2026-11-01-v0.3.9-master-release-plan.md)

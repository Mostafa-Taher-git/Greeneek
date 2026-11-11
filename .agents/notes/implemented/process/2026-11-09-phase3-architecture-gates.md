# Agent Note: Phase 3 repository architecture gates (S3-01..S3-08)

Status: implemented

## Problem

The Master Plan Phase 3 gates (generated project references, dependency rules, adapter conformance, API reports, license inventory, advisory scanning, vendor drift, and scheduled npm updates) lived only in prose or in partial checks. Adding a package still required hand-maintained lists, cross-package coupling had no mechanical fence, adapter chunk-protocol correctness had no shared suite, and the npm publication surface had no diffable API record.

## Decision

Each gate is boring: read manifests, apply an explicit pattern filter, print the resolved list, and fail loud on mismatch.

- **S3-01** `scripts/gen-tsconfig-references.ts` emits both aggregates' `references` from the `packages/<group>/<pkg>` hierarchy (face declared by `tsconfig.host.json`/`tsconfig.client.json` or by `extends`). `packages/client/` is client-only; split packages name their face file; solution roots are in neither. Client extras come from bare `@greeneek/` imports of the client aggregate's included files, because `tsc -b` requires every directly imported file to be listed (for example `gnk-typert-registry` from a gateway client spec). `verify-tsconfig-references` (`--check`) runs in `hygiene`.
- **S3-02** `scripts/verify-dependency-rules.ts` plus `.dependency-cruiser.json` enforce pattern-based (`gnk-*`) rules: `src/` must not import `gnk-agent-loop` (tests mounting the concrete loop for real-composition evidence are deliberately out of scope), no product deep import into a `src/` tree (experimental/test-support internals excluded), no package import cycle, `vendor/` never imports `gnk-` packages, and static value imports must be declared. Runs in `hygiene` and `ci-static`.
- **S3-03** `packages/llm/llm/src/conformance.ts` (`@greeneek/gnk-llm/conformance`) exports `assertChunkProtocol` and `describeAdapterConformance(name, factory)`: index monotonicity per block, no deltas after `block-end`, exactly one `finish`, usage at most once, every `tool-call-delta` carries the call id, and prompt abort. Three specs invoke it: mock (llm), Greeneek (through its mock SSE server), and pi-ai (through its mock server with hand-declared models). New adapters inherit by invoking with their factory.
- **S3-04** `scripts/gen-api-reports.ts` writes a diffable `etc/<short>.api.md` per published package (the release-family patterns; experimental and private deployment roots excluded). Each report is the sorted `export` lines of the package's `src/`. `verify-api-reports` runs in `hygiene` and `ci-static`.
- **S3-05** `scripts/verify-license-inventory.ts` checks every vendored directory carries a `LICENSE` containing `MIT License`, declares `license: MIT`, and is accounted for by the `vendor/README.md` table; the root `LICENSE` and root manifest are MIT. Runs beside `verify-gnk-package-licenses` in `hygiene` and `ci-static`.
- **S3-06** `.github/workflows/advisory-scan.yml` runs `pnpm audit --audit-level=high` weekly and on lockfile/manifest pull requests, failing loud without `continue-on-error`.
- **S3-07** `scripts/verify-vendor-drift.ts` splits the `vendor/README.md` modification list into one `vendor/patches/NN-<slug>.patch` per entry, each stamped with the vendor tree hash. `verify-vendor-drift` runs in `hygiene`, in nightly CI (`.github/workflows/vendor-drift.yml`), and on `vendor/` pull requests. Upstream reconstruction from manifest SHAs belongs to the scheduled agent task (no `VENDOR_UPSTREAM_URL` in CI); the offline check never skips.
- **S3-08** `renovate.json` proposes weekly non-major npm updates grouped as one PR, with `vendor/` excluded (`ignorePaths` plus an npm `vendor/` disabled rule; vendored packages follow the manifest sync procedure). Update pull requests ride the full CI gate suite.

## Alternatives considered

- Vendoring dependency-cruiser as a new devDependency instead of a pattern scanner: rejected for this phase because adding a dependency requires a lockfile update and CI install churn; `.dependency-cruiser.json` records the same patterns for a future swap, and `verify-dependency-rules` enforces them today with no new dependency.
- Generating the client aggregate from `package.json` dependency edges instead of direct imports: rejected because devDependency edges pull the whole host tree (including the concrete loop) into the client program. Direct imports of included files are the precise set `tsc -b` requires.
- A strict agent-loop test ban (only agent-loop tests may import it): rejected because real-composition integration suites across subagent, workflow, and test-support legitimately mount the concrete loop. `src/` isolation is the enforced half.

## Consequences

Adding a package needs zero hand-maintained gate lists: its face picks its aggregate reference, its direct imports widen the client aggregate automatically, and its exports appear in its API report on the next regenerate. A vendored edit without regenerating patches fails hygiene and nightly CI. New adapter packages inherit the conformance suite by invoking it with their factory. Type-only imports and dynamic `require()` calls do not count as dependency edges; experimental and test-support internals are out of scope for the deep-import rule. The retired-preset type errors and other pre-existing dirty-tree failures are outside this change.

## Verification

`pnpm exec vitest run` covers `scripts/verify-license-inventory.spec.ts`, `scripts/gen-tsconfig-references.spec.ts`, `scripts/verify-dependency-rules.spec.ts`, `scripts/gen-api-reports.spec.ts`, `scripts/verify-vendor-drift.spec.ts`, `packages/llm/llm/tests/conformance.spec.ts`, `packages/llm/llm-greeneek/tests/conformance.spec.ts`, and `packages/llm/llm-pi-ai/tests/conformance.spec.ts`. Standalone checks (`pnpm run verify-license-inventory`, `pnpm run verify-tsconfig-references`, `pnpm run verify-dependency-rules`, `pnpm run verify-api-reports`, `pnpm run verify-vendor-drift`) pass on the implemented tree.

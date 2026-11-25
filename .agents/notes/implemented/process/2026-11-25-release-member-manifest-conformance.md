# Agent Note: Release-member manifest and README conformance

Status: implemented

## Problem

The 0.8.8 version unification gave recently added automation, browser, client-UI, and deep-agent packages a release version, which placed them under the workspace constraints gate's release-member rules. Several manifests lacked `publishConfig.access` and `repository`, and five deep-agent manifests published the tsc-emitted `lib/types/**/*.js` tree even though no export targets it. Their READMEs stated the invariant-companion omission as "No companion invariant is published", a word order the companion gate does not recognize. The same new packages left a missing client-renderer devDependency, four stale generated API reports, and preset plugins absent from the Python runtime closure manifest.

## Decision

The affected manifests now declare `publishConfig.access: "public"` and the canonical repository with their own directory. The five deep-agent manifests publish only `lib/index.js` and `lib/types/**/*.d.ts`, matching the gate's computed payload. README omission sentences use the repo-standard "No invariant companion is published" wording, preserving each package's existing reason. The automation-tasks settings page declares `gnk-client-ui-renderer` as a devDependency; the Python runtime closure lists the three preset plugin packages and their two browser-service peers; four API reports were regenerated from source.

## Alternatives considered

Exempting these directories from the release-member rules would hide real publication metadata gaps. Creating empty invariant companions would add files with nothing to check. Hand-editing generated API reports would hide source drift.

## Testing

`pnpm run constraints`, `scripts/verify-package-invariants.ts`, `pnpm run test:docs` (14 gates), `pnpm run gen-api-reports --check`, `pnpm run verify-runtime-closure`, `pnpm run hygiene` (23 gates), `pnpm run typecheck`, and `pnpm run lint` pass. `pnpm-lock.yaml` was regenerated with `pnpm install --lockfile-only --offline` and contains only the six new workspace links; CI installs with `--frozen-lockfile`.

## Consequences

These packages now carry accurate publication metadata, dependency declarations, and generated API surface, and their READMEs satisfy the companion gate with reasons that describe their actual ownership.

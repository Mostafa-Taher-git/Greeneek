# Agent Note: Product version drift gate

Status: implemented

## Problem

The release tool enumerates every gnk-family manifest and requires one version, but nothing checked that invariant outside a bump. Ten first-party manifests added during Deep-agent development had no `version` field, so `release:gnk` refused to run and API report headers could silently disagree with the root manifest.

## Decision

`verify-product-version` treats the root manifest as authoritative and checks every first-party manifest plus every generated API report header against it. Selection uses the `@greeneek/gnk-` name prefix and the `@greeneek/desktop` deployment root; vendor, fixture, landing, and website ranges stay independent. Discovery asserts it found both packages and Desktop so a narrowed glob cannot pass vacuously. The gate runs in `check-all` and the shared CI static gates beside `verify-desktop-version`.

## Alternatives considered

Relying on `verify-api-reports` alone leaves versionless manifests undetected because those packages publish no API report. Running the bump tool as a check requires a target version and mutates manifests, so it cannot serve as a read-only gate.

## Testing

`pnpm run verify-product-version` reports agreement across 280 manifests and 285 API reports at 0.8.8. `pnpm exec vitest run scripts/verify-product-version.spec.ts` covers selection, missing versions, and third-party exclusion.

## Consequences

A versionless first-party manifest or a stale API header now fails before release tooling runs. Independent version namespaces (`SESSION_FORMAT_VERSION`, SQLite `SCHEMA_VERSION`, protocol versions, `desktop-v*` tags) remain outside the gate.

## Related

[2026-08-10-npm-release-sequences.md](2026-08-10-npm-release-sequences.md)

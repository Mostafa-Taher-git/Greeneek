# Agent Note: Client catalog skips host-only merged parts

Status: implemented

## Problem

`gen-cordis-inspect-catalog --check` failed with `merged interface RemoteErrorDetailsMap contains a declaration outside this face`. Session event and remote-error vocabularies are declaration-merged across packages, and several parts live in packages that publish only a Host compiler face. The Client face cannot `registrationForFile` those parts, so the analyzer rejected legitimate Client catalog generation.

## Decision

`WorkspaceAnalyzer` accepts an explicit `partialMergedInterfaces` set. `projectCordisCatalog` supplies it only for the Client face: `SessionEventMap`, `SessionProjectionMap`, `SessionProjectionStateMap`, and `RemoteErrorDetailsMap`. For those four names the analyzer skips parts it cannot attribute to the Client face; every other merged interface is still checked normally. The Client-readable error codes also live in `@greeneek/gnk-api-remotes/types`, which both faces compile, so model-visible code names stay typed in Client programs.

## Alternatives considered

Moving every merged declaration into a dual-face package would require new Client compiler faces for several Host-only capability packages and would widen each package's published API. Disabling the whole merged-interface check would hide real cross-face drift.

## Testing

`pnpm run verify-cordis-inspect-catalog` reports the committed catalog up to date, and `pnpm run typecheck` passes. The skip list is passed as data, not a gate exclusion: the analyzer still validates every other merged declaration and all four vocabularies' Client-readable parts.

## Consequences

Client catalog generation is deterministic again without adding Host-only packages to the Client compiler face. A new merged interface is still checked in both faces; only the four named vocabularies may have Host-only parts.

## Related

[2026-08-10-npm-release-sequences.md](../process/2026-08-10-npm-release-sequences.md)

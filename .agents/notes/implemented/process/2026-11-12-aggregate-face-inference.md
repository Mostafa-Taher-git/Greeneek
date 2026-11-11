# Agent Note: Aggregate TypeScript face inference

Status: implemented

## Problem

The aggregate-reference generator treated a package's `tsconfig.client.json` as a replacement for its root `tsconfig.json` face. `agent-presets` has a host root config and a separate client config, so the host aggregate omitted the package that contributes `SessionEventMap` and Typert could not classify the merged declaration.

## Decision

`facesFor` combines explicit host/client leaf configs with the face declared by a non-solution root config. A root that has `files: []` contributes no face because its leaves own the projects. `referenceFor` continues to select the face-specific leaf when one exists and the root config otherwise.

The host aggregate now includes `./packages/preset/agent-presets`; the client aggregate keeps `./packages/preset/agent-presets/tsconfig.client.json`. The generator spec pins both references so a future config edit cannot omit either face.

## Alternatives considered

Adding a special-case reference for `agent-presets` would preserve the underlying inference bug and would leave another split-face package vulnerable to the same omission.

Adding a new `tsconfig.host.json` to every package with a client leaf would require unrelated package migrations and does not improve the existing root-config contract.

## Testing

`pnpm exec vitest run scripts/gen-tsconfig-references.spec.ts` passes all five tests. `pnpm run gen-tsconfig-references` restores the missing host reference, and `pnpm run verify-tsconfig-references` passes. The full workspace build passes on Windows and in a Linux container after the generated reference update.

## Consequences

Packages can declare a host root project and a separate client leaf without losing the host project from the aggregate. Empty solution roots remain excluded, and packages with explicit face leaves continue to resolve through those leaves.

## Related

- [v0.3.9 master release plan](../../proposed/process/2026-11-01-v0.3.9-master-release-plan.md)

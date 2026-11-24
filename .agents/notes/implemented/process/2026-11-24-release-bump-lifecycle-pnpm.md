# Agent Note: Shell-free pnpm invocation in the release bump

Status: implemented

## Problem

`release:gnk` ran `pnpm install --lockfile-only` by bare name through the shell-free process helper. On Windows only `.cmd` shims are on `PATH`, and Node's `spawn`/`spawnSync` rejects those with `EINVAL` when `shell` is false, so the bump rewrote manifests and then failed before committing.

## Decision

The lockfile refresh resolves pnpm through `pnpmInvocation`, which reads the `npm_execpath` lifecycle variable set by `pnpm run`. A JavaScript entrypoint runs through `process.execPath`; a direct executable runs as-is. The call site is the only change; the generic process helper and its POSIX behavior stay untouched.

## Alternatives considered

Mapping `pnpm` to `pnpm.cmd` in the process helper does not work: Node cannot spawn a `.cmd` shim shell-free on this host. Enabling `shell: true` would change every release step and break the repository's shell-free invocation rule. Creating a `pnpm.exe` shim patches the host instead of the defect.

## Testing

`pnpm exec vitest run scripts/pnpm-invocation.spec.ts` covers the resolver. A real `pnpm run release:gnk 0.8.8` on Windows completed the lockfile refresh and commit. The dry run selects only gnk-family manifests.

## Consequences

Release bumps work on Windows and POSIX without changing the process helper. Running the bump outside a package-manager lifecycle now fails loudly at the lockfile step rather than spawning the wrong executable, consistent with the lifecycle requirement already enforced by `pnpmInvocation`.

## Related

[2026-08-10-npm-release-sequences.md](2026-08-10-npm-release-sequences.md)

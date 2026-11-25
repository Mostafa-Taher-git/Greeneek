# Agent Note: Windows test-lane conformance

Status: implemented

## Problem

The Windows QA lane failed in several tests that encoded POSIX or Linux assumptions: fixed tool catalogs named `bash` regardless of the deployment shell, POSIX mode bits were asserted on NTFS, the LSP e2e used `URL.pathname` and npm's POSIX `.bin` shim, the keyless SDK smoke selected its session log by directory order and parsed a JSONL file as one JSON value, the pwsh ACL e2e omitted `sessionProjections` and mounted its provider before the runtime, and the ACP default-composition `cordis.yml` is a git symlink that a Windows checkout without `core.symlinks` materializes as a text path.

## Decision

Each lane test now derives its expectations from the platform it runs on: shell tool identity, its description, the composed tool catalog, and the POSIX-only mode assertion are platform-gated. `fileURLToPath` replaces `URL.pathname`, and Windows runs the LSP bin module with Node instead of the unspawnable shim. Log selection identifies the main session by its durable header and parses only the header row. The pwsh e2e mounts `LocalSubprocessRuntime` and `SessionProjectionRegistry` before the sandbox provider and policy service. A shared helper resolves the ACP symlink stand-in to the real snapshot path on any checkout mode.

## Alternatives considered

Changing product composition to match stale POSIX goldens would hide genuine platform behavior. Removing the exact-catalog assertions would lose their omission-detection purpose. Turning the symlink into a committed copy would create a second source of truth for the shipped composition.

## Testing

On Windows (temp root relocated to a volume with free space): `lsp-stdio/typescript-server.e2e.ts`, `pwsh-sandbox/acl.e2e.ts`, `profiles/sdk/keyless-smoke.e2e.ts`, `web-auth.e2e.ts`, and `web-agent-presets.e2e.ts` pass together — 5 files, 45 tests. `pnpm run typecheck`, `pnpm run lint`, and `git diff --check` pass.

## Consequences

These five lanes now assert their real Windows behavior without weakening their checks. Remaining #141 gaps (the `test:expected` and Web golden drift, HMR timing, benchmark temp cleanup, and the separately tracked credential-blocked lanes) are outside this change.

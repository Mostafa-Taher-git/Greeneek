# Agent Note: Staged bundle shipped duplicate workspace modules

Status: implemented

## Problem

Every model tool call died in the installed desktop with `Cannot read
properties of undefined (reading 'prepare')`, while dev and CI stayed
green. The tool scheduler seam is a per-module `unique symbol`: the
staged bundle contained two real copies of `@greeneek/gnk-tools` (top
level plus a full duplicate tree under `gnk/node_modules`), so the copy
constructing `ctx.tools` and the copy reading it disagreed on the
symbol and every execution failed before provider selection. Proven by
resolving the specifier from both load paths in the shipped bundle and
comparing symbol identity.

## Decision

Stage the workspace as the single copy it is in development. The copy
classifier only recognized `packages/` and `vendor/` source trees, so
the `apps/cli` subtree (the `gnk` entry the desktop boots) copied its
`node_modules` verbatim with dereferenced symlinks, materializing ~114M
of duplicate `@greeneek` packages. A shared `isWorkspaceTree` helper
now covers `packages/`, `apps/`, and `vendor/` at both classification
sites; nested `@greeneek` scopes under workspace trees keep resolving
by walk-up to the one top-level copy. Verified by wiping `.staging` and
re-running: exactly one `gnk-tools`, both load paths resolve it, empty
nested scope, externals untouched.

## Alternatives considered

**`Symbol.for` for the seam.** Rejected: it would mask the duplication
instead of removing it, leaving every other cross-copy hazard
(`instanceof`, class identity) latent. The symbol design is sound under
the single copy dev and CI already run.

**Hand-maintaining an exclusion list.** Rejected: the classifier already
existed for exactly this purpose and just missed a workspace root; one
predicate covers every current and future app package.

## Consequences

Stale `.staging` output can hide a fix behind old nested trees (found
this way: Sep-9-dated residue beside a fresh run) — wipe the directory
when validating staging changes. The duplicate tree also shrinks the
bundle. Any future `unique symbol` (or `instanceof`) seam stays safe
only while staging ships one copy; the `isWorkspaceTree` specs pin the
classifier on posix and windows paths, including store/install-tree
negatives that must never collapse.

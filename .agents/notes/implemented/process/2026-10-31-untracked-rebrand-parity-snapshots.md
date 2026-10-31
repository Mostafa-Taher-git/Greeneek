# Agent Note: The rebrand parity rig runs from untracked local captures

Status: implemented

## Problem

The rebrand program's parity rig kept its committed capture surfaces on `main`: `.rebrand/baseline/` (the pre-rebrand command, file, package, and URL lists) and `.rebrand/after/` (the post-rebrand lists) were tracked files. They are evidence of a finished one-time migration, not product or configuration: `scripts/rebrand/parity-check.mjs` is the only reader, the closure was already verified as the rebrand program's final gate, and the snapshot content leaked into every full-text search of the repository while presenting stale tooling state to readers on GitHub.

## Decision

`.rebrand/` is no longer tracked. The ten snapshot files were deleted from `main`, and the directory joined `.gitignore`'s local-residue block beside `.artifacts/` and `apps/desktop/.staging/`. The rig stays intact: `rebrand:dry`, `rebrand:apply`, `rebrand:verify`, `rebrand:egress`, and `rebrand:capture-after` work exactly as before, and `parity-check.mjs` still reads whatever captures the operator has on disk. The one-time baseline lives on in git history (the "full plan P0-P10, verified" commit) for anyone who must reproduce it.

`rebrand:parity` against re-captured surfaces is not re-runnable from an untracked tree alone, because the baseline must come from a pre-rebrand revision — capture it with `git checkout` of that revision, or restore the recorded files from history. Running the check outputs `missing artifact ...` for every capture pair, so an accident here fails loudly instead of silently claiming parity.

The three verifiers the executed brand sweep still runs (`verify-attribution`, `verify-residue`, `verify-egress`) keep their `.rebrand/` allowlist entries: they check content of whatever exists, and the entries are inert while the directory is absent.

## Alternatives considered

**Keep the snapshots tracked as permanent parity evidence.** Rejected: the parity gate is not part of the executed CI brand sweep, so the tracked copies bought nothing at run time; they were read exactly once, when the rebrand program landed.

**Delete the whole `scripts/rebrand/` rig.** Rejected: `verify-brand-sweep.mjs` (CI and Lefthook) executes three of its verifiers on every push, and the fork's standing old→new name map under `docs/` documents the mechanical rules. Removing live gates for a finished program would weaken the recurrence guard the program built.

## Consequences

GitHub's repository browser no longer shows a `.rebrand/` directory, and full-text searches no longer surface ten lines of snapshot trivia. The cost is that `rebrand:parity` requires deliberately restoring or re-capturing its inputs; the failure mode names every missing artifact, so nobody mistakes the empty directory for a passing state.

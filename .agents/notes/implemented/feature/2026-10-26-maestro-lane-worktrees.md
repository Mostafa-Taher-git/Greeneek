# Agent Note: Give every writable Maestro lane its own worktree

Status: implemented


## Problem

Maestro lanes ran in one checkout. Two members editing the same relative path saw each other's writes, so a lane's result was not attributable to the lane, and the Lead's review could not tell a member's diff from a sibling's edit or from the Lead's own work. The plan's G1 gate says a three-lane parallel task must complete with no shared-checkout writes; that is impossible while every lane shares a directory, and a prompt instruction to "only edit your files" is not isolation.

Git worktrees are the isolation primitive already present on every machine the harness supports. The difficulty is ownership: a worktree is a second checkout of the same repository, so a manager that creates one must also record what it was cut from, refuse to leave the repository, and clean up only what it made.

## Decision

`WorktreeManager` in `packages/subagent/agent-team` owns writable lanes. `create({ sessionId, lane, signal })` cuts `<gnkHome>/worktrees/<sessionId>/<lane>` on branch `gnk-lane/<sessionId>/<lane>` from the repository's current `HEAD`, records that revision in a frozen `LaneWorktree`, and returns it. `list` reports live lanes only when git still registers them and the directory exists, and it never mutates. `remove` deletes the checkout link-safely, prunes the registration, deletes its own `gnk-lane/` branch, and is idempotent; when something survives it fails as `WORKTREE_REMOVE_INCOMPLETE` naming what remains instead of reporting success.

Containment is enforced at path construction. Session id and lane are each one safe segment — a leading alphanumeric, then letters, digits, dot, underscore or dash, at most 64 characters, refusing `..`, a trailing dot, and `.lock`. Beyond that, the session directory must resolve through `realpath` to a location under the worktrees root, so a symlinked session root cannot redirect a checkout outside it. Existing paths and branches are `WORKTREE_EXISTS`, a non-repository root is `WORKTREE_NOT_A_REPOSITORY`, and an empty repository is `WORKTREE_NO_BASE_REVISION`; raw git text never reaches a caller as the error.

Every git invocation is an argv array with the caller's `AbortSignal`, a 1 MiB output bound, and `windowsHide`, and the runner is injectable. The module is deliberately Cordis-free — it holds no state and reads no service — so it defaults to `execFile` and exposes the seam where a `ctx.subprocess` adapter can be bound later without touching call sites. The package README's Known Limitations states that choice and its reason.

## Alternatives considered

**A shared checkout with advisory write scopes.** Rejected: the existing Team service already documents that bash, formatters, and generators bypass advisory checks, so a scope can only ever be a hint.

**A copy of the tree per lane instead of a worktree.** Rejected: a copy doubles disk use, loses the git link that lets the Lead diff a lane against its base revision, and cannot be cleaned up by git.

**Let each lane create its own worktree.** Rejected: cleanup on cancel and error, the no-escape guarantee, and naming every live lane need one owner that can be asked what exists.

## Consequences

- A lane checkout is a real branch in the repository's worktree list, so `git worktree list` shows it while it lives and `pnpm` must install in it before tests run there.
- The manager does not yet create a lane on start, pass its path as the child cwd, enforce the no-commit rule, merge serially against the recorded base, or clean up on cancel, error, and Team disposal. Those are the next wiring step and stay recorded in the ledger; until they land, isolation is available but not automatic.
- Nothing in this module decides permissions. A lane that can execute bash can still write outside its checkout; confinement remains the sandbox and approval policy's job, and this manager only guarantees that lanes which respect their cwd do not collide.

## Testing

`packages/subagent/agent-team/tests/worktrees.spec.ts` runs against real `git init` repositories in a temp directory: two lanes write the same relative path without seeing each other, the base revision is recorded and listed, `../escape` and an absolute lane name are refused, a second create for the same lane fails with the typed collision error, removal is idempotent and also removes an unknown path's directory, a non-repository root fails loud, an aborted create leaves nothing, and a removal that cannot finish reports what remains. The module measures 100 % statements, branches, functions, and lines; the package lane is 83 tests with one platform-conditional skip.

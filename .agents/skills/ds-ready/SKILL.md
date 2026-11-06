---
name: ds-ready
description: "Runs the full ds-ship workflow but stops with the pull request ready for a human to merge, and never merges. Use when the user says get it ready, make it mergeable, stop before merge, or /ds-ready."
---


Do all of `ds-ship` except the merge. Hand the user an open PR that passes the merge gate.

The request grants the same test permission as `ds-ship`, and you may commit, push, rebase and `--force-with-lease` this task's branch. You may not merge.

## Steps

1. Read `ds-ship` and follow its steps 1 to 6: branch, change, prove, review, file, watch.
2. Before the first push, turn off auto-merge and take the PR out of any merge queue. Check again before each push. If you cannot stop automatic merging, report that before you continue.
3. After the last fix, re-prove any behavior change and any non-trivial conflict resolution.
4. Fetch the base branch. Read the live PR: head SHA, base, checks, reviews, mergeable state. Confirm it is open and not a draft.
5. Apply the `ds-ship` merge gate and pick one verdict:
   - **Ready**: the gate passes. Leave the PR open.
   - **Waiting on approval**: only a required human approval is missing. Confirm that this is the real blocker.
   - **Blocked**: say what stops it, what you tried and what is needed.
6. Report the PR link, final head SHA, verdict, proof, review outcome and remaining risks. State that the PR is open and unmerged.

## Stop when

- You reach one of the three verdicts and the report is written.
- Someone else merged the PR. Report that.
- Six fix-and-watch cycles pass without a green gate. Report Blocked.

## Rules

- Never merge, turn on auto-merge, join a merge queue or push to the default branch.
- Do not ask another agent to do any of those things for you.
- Show evidence for the verdict: the check list and mergeable state you read.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

In Greeneek this stops before any push or merge: leave the reviewed, verified commit on `main` with the ledger and Resume State current, and name the exact remaining gate. Never merge, tag, or publish.

---
name: ds-ledger
description: "Keep a one-row-per-decision log during long or unattended runs, and re-read it before each step so the run does not drift from its goal. Use for multi-phase or autonomous work, work a human will review later, or /ds-ledger."
---


# ds-ledger

A long run forgets its own reasons. A short written ledger keeps the goal in view and lets a reviewer trust the result.

## Steps

1. Create one TSV file, for example `.ds-ledger.tsv`, with the header `ts	phase	decision	why	evidence	result`. Put the goal and done condition in the first row.
2. Before each step, re-read the goal row and the last ten rows. Check that the next step still serves the goal. If it does not, log the drift and correct course.
3. After each real decision, append one row:
   - ts: ISO 8601 time.
   - phase: the phase or workstream.
   - decision: what you chose or did, one line.
   - why: the reason in plain words.
   - evidence: a pointer, never prose. A commit hash, `file:line`, a command and its result, or an artifact path.
   - result: the outcome, such as "tests pass", "reverted", "open".
4. Keep each cell on one line with no tabs.
5. Log reverts and dropped work too, with the reason. Failures are the most useful rows.
6. At the end, add a summary row and point the user to the file. Commit it only if a reviewer needs it.

## Stop when

- The run ends and the summary row is written.
- If three rows in a row show no progress toward the goal, stop the run and report.

## Rules

- Every row needs evidence you can open or rerun. "Looked fine" is not evidence.
- Write rows the way you would tell a teammate, plain and concrete.
- Do not rewrite old rows. Append corrections.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

The master plan's Execution ledger is authoritative; append a dated row there (newest first) with the exact commit, changed files, commands run, results, blockers, and next action. `.ds-ledger.tsv` is optional and supplementary. A checkbox in that plan is ticked only when all five parts of its "Reading the checkboxes" contract hold; a blocked box gets a `BLOCKED:` note naming the missing input, never a tick.

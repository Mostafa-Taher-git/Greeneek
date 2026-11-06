---
name: ds-swarm
description: "Fan out N parallel workers on slices of a job or on a race, collect every result, and return one evidence-backed report. Use for wide coverage, audits, races between approaches or exploration, or for /ds-swarm, 'swarm this', 'split this across workers'."
---


# ds-swarm

Split work that is wide but shallow across parallel workers, then merge their proven results into one report.

## Steps

1. State the done condition and the report the swarm must return.
2. Pick the shape. Partition the job into non-overlapping slices, or race N workers on the same brief, or both. For a race, decide up front how you will choose: first pass, rank all, or best one.
3. Write one brief per worker that stands alone: goal, exact slice, how to verify, what to report. When workers test specific commits, name the exact commit hashes and the measurement method.
4. Give every worker that writes files its own output location.
5. Spawn all workers at once. If the harness cannot run subagents, run the briefs one by one in fresh contexts.
6. Each worker reports PASS, ISSUES or BLOCKED with evidence: commands run and their output. ISSUES lists every provable issue, not just the first.
7. Collect results. Reject any result with no evidence or the wrong commit and respawn that worker once. A second miss is a recorded gap, not a pass.
8. Merge into one report: the verdict, each slice or arm with its evidence, gaps, and duplicates merged by root cause.

## Stop when

- Every slice has a result or a recorded gap and the report is written.
- Or a race has a winner under the rule from step 2.
- Never respawn a worker more than once.

## Rules

- Workers do not share writable state.
- A missing slice is never counted as passing.
- Report what workers proved, not what they claimed.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

Greeneek's swarm is Maestro: use the Fleet roster with Harmony (continuable lane) and Melody (one-shot) members, each with its own provider, model, effort, and timeout. Workers must not commit, push, or re-record goldens; merge only verified results and name every worker's evidence in the report.

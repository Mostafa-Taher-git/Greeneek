---
name: ds-review-loop
description: "Runs an author and a fresh-context reviewer in a loop on the current change until both agree it is correct, for at most four rounds. Use before or after filing a PR, when the user says review loop, get it reviewed, or /ds-review-loop."
---


Make a change more correct by letting one fresh reviewer push back until you both agree.

## Steps

1. Scope the change. Run `git status --short`. Do not stash, discard or include unrelated files. Find the base: `git fetch origin`, then `git merge-base HEAD origin/<base branch>`. Use one diff command for every round.
2. Write the goal and out-of-scope list in two sentences. Run the covering checks. Do not send code that fails them.
3. Pick the reviewer: a stronger model if the harness can reach one (subagent with a model setting, team worker, second CLI), or else a fresh DeepSeek context with no history. Record which one.
4. Send this brief:

   ```
   Review only. Do not edit, commit, push, comment or start subagents.
   Repo: <path>  Base: <sha>  Diff: git diff <sha> [-- <paths>]
   Goal: <goal>  Out of scope: <list>  Checks: <results>
   Read the code around the diff. Find bugs, broken callers and gaps against the goal.
   Flag code the goal does not need. Ignore style unless it hides a bug.
   blocker = goal case is wrong. should = real bug users will hit. nit = anything else.
   Reply: VERDICT: APPROVE or CHANGES, then one line per finding:
   R1 [blocker|should|nit] file:line claim. Fix: suggestion
   ```

5. Wait for the reply. Do not edit the scoped files while the review runs. A timeout or error is not approval.
6. Judge each finding yourself. Agree: make the smallest fix, preferring to delete or narrow code. Disagree: reply with evidence (file:line, test output). Nit or out of scope: decline in one line.
7. Keep a ledger: id, severity, outcome, evidence. Re-run checks and `git diff --shortstat`. If the diff grew, cut it back.
8. For the next round send the brief, the ledger and the changes since the last round. Ask the reviewer to check only open ids and changed code.

## Stop when

- The reviewer returns APPROVE on the current diff, no blocker or should is open, and you have no concern left.
- A round returns only nits.
- Four rounds are done, or one item stays disputed after two exchanges. Report both sides in two or three lines each and let the user decide. This is not approval.

## Rules

- One reviewer at a time. Never agree just to end the loop.
- Do not push during the loop. Push afterward only if the user asked to push or ship.
- If you update a PR, add: `Reviewed with ds-review-loop: <N> rounds, <reviewer>, verdict <verdict>.`
- Report rounds, reviewer, fixed and declined findings with reasons, and diff size before and after.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

Run the covering checks named in `ds-verify-loop` before handing the diff to a reviewer. The reviewer must reject any claim of completion whose evidence is a mock, a skipped test, or a passing superficial check.

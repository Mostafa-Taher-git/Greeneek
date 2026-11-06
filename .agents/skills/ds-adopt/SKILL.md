---
name: ds-adopt
description: "Takes over an existing PR, branch or agent thread and finishes its original goal while keeping credit for the first contributors. Use when the user says take over, adopt, pick up or finish this PR, or /ds-adopt."
---


Finish someone else's work as if it were yours, but credit them for what they did.

## Steps

1. Read the source PR, branch or thread in full: description, commits, review comments and any later corrections from the user.
2. Find the real current state: the head SHA, uncommitted changes and open review findings. Treat the handoff notes as hints, not facts.
3. Write down the original goal in one sentence.
4. Choose where to work. By default, make a new branch with the original commits on it and add your fixes as separate commits. Continue in place or stack only if the user asked for it.
5. Run `ds-revive` to bring the work up to date with the base branch.
6. Fix what is needed to reach the original goal. Simplify where you can, but keep every intended behavior.
7. Verify on your own. Reproduce the original problem, then show it fixed. Run the real workflow, not only mocked tests. Record the commands and output.
8. Check the source PR again. It may have changed while you worked.
9. If a PR is wanted, file it with `ds-pr`, then watch it with `ds-watch-pr`. Use `ds-pr-comments` for any reply.
10. Report what you inherited, what you changed, how you verified it, how credit was kept and what is still open.

## Stop when

- The goal is reached, verified and reported.
- The goal is unclear, or finishing it needs a product decision. Ask the user.
- Verification fails three times in a row on the same issue. Report the blocker.

## Rules

- Keep the original Git authors and co-author trailers. Name the contributors and link the original PR in the description.
- If the PR will be squashed, keep human co-author lines in the squash message. Use verified identities only, never guessed emails.
- Do not defend the old code because it exists. Do not add unrelated features.
- Do not edit, merge or close the original PR without permission.
- State plainly what you could not verify.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

The master release plan is the handoff, and its "do not assume previous notes are accurate" rule is literal. Verify HEAD, `git status`, branches, concurrent writers, and the runner verdict before acting. Never discard user changes or another agent's uncommitted work.

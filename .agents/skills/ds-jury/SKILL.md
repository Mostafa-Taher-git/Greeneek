---
name: ds-jury
description: "Gets independent reviews of a change from two or three different models or providers and loops on fixes until they agree. Use when the user says jury, panel review, second opinions, ask other models, or /ds-jury."
---


Get two or three independent reviewers to judge the same change, then fix until they agree.

## Steps

1. Get the work ready first. Answer open PR comments, fix known issues and run the relevant checks. Skip this only if the user wants to throw the code away.
2. Pick the jurors. Use models the user named. Otherwise pick the strongest available model from two or three different providers, at high reasoning effort.
3. Find a way to reach them in this harness: team workers or subagents with a model setting, a second agent CLI in the terminal (for example a Codex or Claude CLI), or an API call. If only one model is available, start two or three fresh-context subagents of that model, each with a different persona: correctness, security and edge cases, simplicity and scope.
4. Write one brief for all jurors: repo path, base SHA, diff command, goal in one sentence, out-of-scope items and check results. Tell them to review only and change nothing.
5. Ask each juror for: a verdict (APPROVE or CHANGES), a score out of 10 and findings as `id severity file:line claim fix`. Severity is blocker, should or nit.
6. Run the jurors in parallel. Wait for all of them. A timeout or error is not approval.
7. Check each finding against the code yourself. Fix the ones you agree with, with the smallest change. Write a one-line reason for each one you reject.
8. Re-run checks. Start a new round with the same brief, your answers and the new diff.
9. Report the result. If there is a PR, edit its description and add a table: juror, model, score per round. Write `no score` when a juror gave none. If there is no PR, put the table in your final reply.

## Stop when

- Every juror returns APPROVE with no open blocker or should finding.
- Three rounds are done. Report the open disagreements, with both sides in two lines each. The user decides.
- A round returns only nits. Stop without another round.

## Rules

- Jurors are read-only. They do not edit, push, comment or start their own subagents.
- Say which jurors are the same model as each other. Do not claim a provider you did not reach.
- Never invent a score or verdict.
- Guard the scope. Decline new features and list them as follow-ups.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

In Greeneek, independent reviewers go through Maestro/Fleet over the `SubagentProvider` seam, where each provider advertises its real capabilities. A mock CLI is never reported as a real-CLI verdict. If no second harness is available, run fresh-context reviewers of the current model and say so explicitly.

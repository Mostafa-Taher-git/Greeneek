---
name: ds-catchup
description: "Give the user a short plain-language catch-up on what changed since their last message, followed by every decision still waiting on them. Use when the user returns after a long or unattended run, asks 'where are we', 'what did I miss', or types /ds-catchup."
---


# ds-catchup

Bring the user back up to speed in a minute, and hand them every call only they can make.

## Steps

1. Keep this turn read-only. Do not change code, start jobs or post anything.
2. Collect what happened since the user's last message: your own work, subagent reports, and messages from others. Tool notifications are not user messages.
3. Check the current state of anything touched: tests, branches, PRs, running jobs. Use fresh command output, not memory. Fix any number that does not match the source and say you fixed it.
4. Write what changed in under 100 words. Say what it means for the user, for example "the login bug is fixed and its test passes". Leave out hashes, paths and commands unless the user needs one to act.
5. List decisions waiting on the user. A decision is something only they can do: a product choice, an approval, an irreversible action, or access you lack. Include old ones still open. For each give: what it changes, the evidence, the risk, your recommendation, and "unknown" for missing facts.
6. If nothing waits on them, say so plainly.

## Stop when

- The catch-up and the decision list are written. One reply, no follow-up work.

## Rules

- Never invent a decision to fill the list.
- Work you can still do yourself is not a decision for the user.
- Name things the way the user would, not by internal labels.
- Short sentences, no jargon.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

Read the master plan's Resume State and the newest Execution ledger rows first, then verify HEAD and `git status` against them. Historical checkpoint SHAs in the handoff are history, not current state. List owner-supplied blockers (OWN-03, OWN-04, GREENEEK_API_KEY, NPM_TOKEN) as decisions only the user can make.

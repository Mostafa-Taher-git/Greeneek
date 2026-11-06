---
name: ds-unstick
description: "Break out of a repeating failure: name the assumption behind all the failed fixes, test it directly, list three other approaches, pick one, and restart clean if needed. Use when the same error or wrong behavior comes back after two fix attempts, or when you notice you are retrying small variations. Invoke as /ds-unstick."
---


# ds-unstick

When two fixes fail the same way, the problem is usually a wrong belief, not a wrong edit. Find that belief and test it.

## Steps

1. Stop editing. Do not try a third variation of the same fix.
2. Write down each failed attempt in one line: what you changed and what happened. Include the exact error text.
3. Write the assumption that all of those attempts shared. Typical examples: "this file is the one that runs", "the config is loaded", "the function receives a string", "the cache is cleared", "the error comes from my code". Name one, in one sentence.
4. Test that assumption directly with the cheapest probe that gives a yes or no answer: a print statement, a log line, a `which` or `--version`, a grep for the real call site, a minimal script, or a read of the docs for the exact version installed. Paste the result.
5. If the assumption is false, you have found the real problem. Plan the fix from the new fact.
6. If the assumption holds, list 3 different approaches. "Different" means another mechanism, library, layer or data path, not a tweak of the same edit. Give each approach one line on cost and risk.
7. Pick one approach and say why in one sentence.
8. Restart from a clean state if the failed attempts left debris: revert them with git (`git stash` or `git checkout -- <files>`), then apply only the chosen approach.
9. Record the false assumption or the chosen approach in PROGRESS.md (see ds-context-reset) so a later session does not repeat the attempts.
10. Return to ds-verify-loop with the new approach.

## Stop when

- The probe in step 4 explains the failure, or the new approach passes its check.
- Two rounds of this skill have failed. Stop and report to the user: the attempts, the assumptions you tested, and the evidence. Ask for direction.

## Rules

- Do not repeat a fix that has already failed, even with small changes.
- Evidence beats reasoning. If a probe takes a minute, run it.
- Keep the failed-attempt list, because it is the most useful part of the report.
- Use a clean state before a new approach, so that old edits cannot hide the result.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

A second identical runner failure is a signal to read `gh run view --log-failed`, not to retry. This repo forbids blind retries and raising timeouts without a diagnosed cause; classify the failure against real output before changing anything.

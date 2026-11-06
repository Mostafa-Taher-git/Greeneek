---
name: ds-sharpen
description: "Restate the user's goal, make the task deeper rather than bigger, rewrite the prompt, and optionally attack the plan to find weak spots. Use before starting vague or high-stakes work, for 'sharpen this', 'what am I really asking', 'stress test this plan', or /ds-sharpen."
---


# ds-sharpen

A sharper prompt saves more tokens than any loop. Fix the ask before doing the work.

## Steps

1. Restate, in your own words, what the user wants and the problem behind it. Keep it to three sentences. If you cannot, ask one question.
2. Deepen the task. Answer briefly:
   - What would a top professional do here that the user did not ask for?
   - What raw material would they start from, instead of a summary?
   - What methods and tools would they use?
   - What outside check, not you or the user, would show the result is right? Name a command, test, metric or source.
3. Rewrite the prompt to ask for exactly that. Keep it no bigger in scope. Leave choices that belong to the user open and list them.
4. Optional stress test, when the plan is risky or the user asks. Spawn two or three subagents with fresh context and give each the plan and the goal. Ask each to break it and back every finding with a run: a failing test, a probe script, or real command output. Drop findings with no run behind them.
5. Present the restatement, the rewritten prompt, open choices, and any surviving findings with their commands and output.

## Stop when

- The user accepts or edits the rewritten prompt.
- Or the stress test returns. Do not loop it more than once without the user.

## Rules

- Deeper, not bigger. Do not add features.
- Do not apply fixes from the stress test. Report them.
- A finding without output is an opinion. Leave it out.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

The owner's architecture decisions are binding scope, not suggestions to sharpen away: Harness is the unit of execution, Harnesses advertise models and capabilities, `fork`/`spawn` are internal execution strategies, Harmony/Melody stay execution types, Maestro keeps central authority, and Multi-Harness Debate is a first-class orchestration mode.

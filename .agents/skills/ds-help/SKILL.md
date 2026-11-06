---
name: ds-help
description: "Pick the right deepseek-stack skill for a task and explain how the pack fits together. Use when the user asks which skill to use, what the pack contains, or types /ds-help."
---


# ds-help

Match the task to one skill, say why in one line, then run it.

## Pick a skill

| If the task is... | Use |
|---|---|
| Any coding session (always on) | ds-mode |
| Vague or high stakes | ds-sharpen, then ds-plan-loop |
| More than one file or step | ds-plan-loop |
| A new module or API shape | ds-blueprint |
| Any code change | ds-verify-loop |
| A bug with a cheap test target | ds-tdd |
| The same failure twice | ds-unstick |
| A long run or a full context | ds-context-reset, ds-ledger |
| A hard artifact where one try may miss | ds-best-of-n |
| Wide coverage, audits or races | ds-swarm |
| A review before merge | ds-review-loop, or ds-jury for several models |
| A risky change | ds-blast-radius |
| A new UI | ds-design |
| A UI that looks generic | ds-design-audit |
| Opening a PR | ds-pr |
| Watching CI and bots | ds-watch-pr |
| Change to merged PR, unattended | ds-ship |
| Same, but stop before merge | ds-ready |
| Someone else's PR or branch | ds-adopt |
| An old PR | ds-revive |
| Understanding code | ds-explain |
| Coming back after a long run | ds-catchup |
| Repeated agent mistakes | ds-lessons |
| Writing prose or docs | ds-unslop |
| Rules of thumb | ds-principles |

## Rules

- Recommend one skill. Name a second only if the task clearly has two phases.
- If no skill fits, say so and work with ds-mode alone.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

### Greeneek pack

All 29 skills in this pack are installed at `.agents/skills/ds-*` and are user-invocable as `/<name>` through the `tool-skill` gesture, which is separate from the closed `ctx.commands` namespace. They are discovered at runtime by `@greeneek/gnk-skill-filesystem` from the rank-200 `.agents/skills` root; no generated catalog needs regeneration when a skill is added or edited.

The working program is the [v0.3.9 master release plan](../../../.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md). Start with `ds-catchup` to read current state, `ds-mode` for the always-on rules, `ds-plan-loop` for anything touching more than one file, `ds-verify-loop` and `ds-tdd` for implementation, `ds-review-loop` or `ds-jury` before a gate, and `ds-ledger` / `ds-context-reset` to keep the plan's ledger and Resume State honest.

Greeneek-specific provenance and the upstream MIT license are recorded in [UPSTREAM.md](UPSTREAM.md).

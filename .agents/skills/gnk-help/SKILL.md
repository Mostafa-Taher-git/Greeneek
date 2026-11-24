---
name: gnk-help
description: "Pick the right deepseek-stack skill for a task and explain how the pack fits together. Use when the user asks which skill to use, what the pack contains, or types /gnk-help."
---


# gnk-help

Match the task to one skill, say why in one line, then run it.

## Pick a skill

| If the task is... | Use |
|---|---|
| Any coding session (always on) | gnk-mode |
| Vague or high stakes | gnk-sharpen, then gnk-plan-loop |
| More than one file or step | gnk-plan-loop |
| A new module or API shape | gnk-blueprint |
| Any code change | gnk-verify-loop |
| A bug with a cheap test target | gnk-tdd |
| The same failure twice | gnk-unstick |
| A long run or a full context | gnk-context-reset, gnk-ledger |
| A hard artifact where one try may miss | gnk-best-of-n |
| Wide coverage, audits or races | gnk-swarm |
| A review before merge | gnk-review-loop, or gnk-jury for several models |
| A risky change | gnk-blast-radius |
| A new UI | gnk-design |
| A UI that looks generic | gnk-design-audit |
| Opening a PR | gnk-pr |
| Watching CI and bots | gnk-watch-pr |
| Change to merged PR, unattended | gnk-ship |
| Same, but stop before merge | gnk-ready |
| Someone else's PR or branch | gnk-adopt |
| An old PR | gnk-revive |
| Understanding code | gnk-explain |
| Coming back after a long run | gnk-catchup |
| Repeated agent mistakes | gnk-lessons |
| Writing prose or docs | gnk-unslop |
| Rules of thumb | gnk-principles |

## Rules

- Recommend one skill. Name a second only if the task clearly has two phases.
- If no skill fits, say so and work with gnk-mode alone.

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

All 29 skills in this pack are installed at `.agents/skills/gnk-*` and are user-invocable as `/<name>` through the `tool-skill` gesture, which is separate from the closed `ctx.commands` namespace. They are discovered at runtime by `@greeneek/gnk-skill-filesystem` from the rank-200 `.agents/skills` root; no generated catalog needs regeneration when a skill is added or edited.

The working program is the [v0.3.9 master release plan](../../../.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md). Start with `gnk-catchup` to read current state, `gnk-mode` for the always-on rules, `gnk-plan-loop` for anything touching more than one file, `gnk-verify-loop` and `gnk-tdd` for implementation, `gnk-review-loop` or `gnk-jury` before a gate, and `gnk-ledger` / `gnk-context-reset` to keep the plan's ledger and Resume State honest.

Greeneek-specific provenance and the upstream MIT license are recorded in [UPSTREAM.md](UPSTREAM.md).

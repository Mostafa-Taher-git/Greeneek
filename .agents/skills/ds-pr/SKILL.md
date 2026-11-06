---
name: ds-pr
description: "Files a short, clear pull request for the current branch. Use when the user asks to open, file or create a PR, or says /ds-pr."
---


Open one real PR whose title and description a busy reviewer can read in ten seconds.

## Steps

1. Check if a PR already exists for this branch (`gh pr list --head <branch>`). If it does, update it.
2. Diff the branch against its base, usually `origin/main`. Confirm the diff matches the goal and holds nothing unrelated.
3. Read the titles of a few recently merged PRs and copy their format.
4. Write a title that says what changed for the user and why it matters, not which function moved. Example: "Cut websocket frames by 70% with compression" beats "Negotiate permessage-deflate".
5. Write the description in this order:
   - The problem, in one or two plain sentences taken from the user's request.
   - The fix, in one or two sentences.
   - One line on how it was proven, if you have proof.
   - A closing line: `Created with <model> in <harness>.` Use the model name the harness reports. If it reports none, name only the harness.
6. Scan the title, body and any attachments for secrets, tokens, private paths and personal data. Remove them.
7. Create the PR as ready for review, not a draft, so review bots run.
8. Print the PR URL that GitHub returned.

## Stop when

- GitHub returned a PR URL. Hand off to `ds-watch-pr` if the user asked for watching.
- `gh pr create` fails twice. If the error is a GraphQL rate limit, retry once through REST: `gh api repos/<owner>/<repo>/pulls -f title=... -f head=... -f base=... -F body=@body.md`. If that fails too, report the error.

## Rules

- No file-by-file change lists in the description.
- Do not post follow-up comments unless the request needs one. Use `ds-pr-comments` when it does.
- Never guess a model name.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

Greeneek works on `main` in PR-sized vertical slices; open a PR only when the owner asks for one. Generated artifacts, source, tests, docs, and the Execution ledger land in the same commit when they form one contract. Never stage untracked scratch (`.{*}.log`, `.{*}.mjs`, `.recore/`), credentials, `.env`, or personal paths.

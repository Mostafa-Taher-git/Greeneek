---
name: ds-blast-radius
description: "Find what a change could break outside its own diff, then prove the key safety fact by running real code. Use before shipping a risky or untrusted change, for 'what could this break', 'blast radius of X', or /ds-blast-radius."
---


# ds-blast-radius

Listing callers is easy. The job is finding the breakage that a text search will not show, and proving the change is safe with a run instead of an argument.

## Steps

1. Read the change: the diff, the symbols it adds, changes or removes, and the behavior it now has that the diff does not spell out.
2. Find the one or two facts the change is safe because of, for example "this only removes cache entries that are already expired". Most risk clears if that fact holds. Spend your effort here.
3. Look where search stops. Read the source of libraries you call at their pinned version. Check timing: async ordering, teardown, retries. Follow data that leaves the code: API responses, database columns, file formats, config, other languages reading the same data.
4. Grade each key fact by how far you proved it:
   1. you said so (worthless alone),
   2. you pointed at a real file and line,
   3. you traced the failure path and showed it cannot be reached,
   4. you ran a script or test against the real code that fails loudly if you are wrong,
   5. you reproduced it in the running app.
5. Push each key fact to level 4 when it is cheap. Usually that is one small script calling the exact function in question.
6. Report: the key facts, their proof level with the command and output, any real breakage found, and what stayed unproven.

## Stop when

- Every key fact is at level 4 or higher, or you have said why it could not be, and the report is written.
- Or you found a real break. Report it with the repro and stop.

## Rules

- A convincing write-up is not proof. Show output.
- Do not fix anything here. Hand fixes to the normal flow.

## Greeneek working contract

This skill is installed in the Greeneek repository. Where a step below conflicts with these rules, these rules win.

- Restate the goal in one line, read the real files before editing, and work on `main` in small vertical slices. Preserve uncommitted and concurrent work; never reset, force-push, or overwrite another session's changes.
- Evidence before "done": run the real check and record the exact command and its output. Never weaken a test, add a blind retry, raise a timeout without a diagnosed cause, or delete a failing assertion to get green.
- Agent waves never commit, push, tag, or publish. No npm auto-publish on `main`; release tags are immutable and Item 8 stays last.
- Live model lanes stay BLOCKED without `GREENEEK_API_KEY`; mocked coverage is never reported as real-CLI verification.
- Registrations are effects, ESM everywhere, and misconfiguration fails at the earliest resolvable point.
- Source of truth: `.agents/notes/proposed/process/2026-11-01-v0.3.9-master-release-plan.md`. Append evidence to its Execution ledger and keep its Resume State current in the same commit as the change.

## Greeneek-specific override

Include generated catalogs, the client three-locale i18n parity gate, recorded Web goldens, the plugin/config catalogs, and the master plan ledger in the blast radius. When docs or catalogs move, run `pnpm run doc-sync`; when a package changes, run `pnpm run hygiene`.

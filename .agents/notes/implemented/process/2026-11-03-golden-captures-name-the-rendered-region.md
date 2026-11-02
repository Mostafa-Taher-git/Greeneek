# Agent Note: A golden capture targets the region the product renders

Status: implemented

## Problem

Two Web scenarios timed out inside `captureStableAria` on `locator.ariaSnapshot: Timeout 30000ms exceeded — waiting for locator('[role="dialog"]').first()`, which reads like an accessibility-serialization defect in the Settings subtree. It was not one. `5dde9feb` ("feat(web): make settings a full page and refine desktop ui") replaced the modal shell `<div role="dialog" aria-modal="true">` plus mask with `<main className={css.panel} aria-labelledby={titleId}>` and migrated the `getByRole('dialog', ...)` queries in eight scenario files, while `apps/web/tests/plugin-config.e2e.ts` and `apps/web/tests/onboarding-usable-provider.e2e.ts` kept capturing a role the product no longer renders. A locator that matches nothing and a subtree that is slow to serialize report the same way, so the lane's failure text could not tell them apart and the timeout looked like a product problem.

The same class produced two more failures. `github-ready-review`'s `getByText(TITLE, { exact: true })` matched a session title rendered both inside `[role="tree"][aria-label="Sessions"]` and in a button outside it, and that dual rendering is intended product behaviour. `trajectory-image-display`'s `findByRole('tabpanel')` matched Chat's details column as well as the Trajectory panel, which mount together.

## Decision

Each capture and query names the region the product owns: `main:not([hidden])` for the Settings page, which is the region `apps/web/tests/models-settings.e2e.ts` already pinned; the Sessions tree for the title click, which is the region the same test captures next; and the `#trajectory-detail-panel` id that `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` declares for the panel. No timeout was widened and no assertion was removed, because the assertions were never what failed. Where the captured region genuinely changed shape, the golden is re-recorded from the ubuntu lane — never from a Windows host, because the plugin-card inventory depends on rows that `packages/bundle/base/cordis.patch.yml` gates per platform — and each diff is attributed to the commit that moved it.

## Alternatives considered

- Re-record with `[role="dialog"]` and raise the timeout. Rejected: the locator matches no element, so a refresh writes nothing and a longer wait only hides the cause behind the same message.
- Drop the two goldens as obsolete. Rejected: they assert the whole Settings region's structure, which is the thing a page conversion should move deliberately rather than silently.
- Keep the unscoped title text and click `.first()`. Rejected: it passes by clicking whichever surface sorts first, which is not the row the test then captures.

## Consequences

`packages/client/ui-settings-general/src/client/SettingsRoot.tsx` prose now describes a page panel rather than a centered modal: documentation that calls the region a dialog invites the next scenario to query one. Normalizers over host paths must accept both separators — `normalizeAria` derived the workspace basename with `workspaceCwd.split('/')`, which never matches a Windows path, so captures kept a per-run random basename where the golden holds `{{workspace}}` and a re-record on that host would have committed nondeterminism the next run fails on.

## Verification

`CI=true GNK_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/plugin-config.e2e.ts` → 6 passed, 1 failed, and the failure is the golden compare itself (`dialog "设置"` → `main "设置"`, `navigation` gaining its accessible name, a `Fleet 设置` section the golden predates) rather than a timeout. `apps/web/tests/trajectory-image-display.expected.e2e.ts` passes. `apps/web/tests/github-ready-review.e2e.ts` raises no strict-mode violation and its session-tree section now matches, leaving only banner drift. `pnpm exec oxlint -c .oxlintrc.json` over the touched files: 0 warnings, 0 errors.

## Related

- [Recorded session fixtures store zero for wall-clock fields](2026-11-02-recorded-session-fixtures-zero-wall-clocks.md)
- [The sidebar carries its own fold control on the host that has no titlebar](../feature/2026-11-02-web-sidebar-fold-control.md)
- [v0.3.9 master release plan](../../proposed/process/2026-11-01-v0.3.9-master-release-plan.md)

# Agent Note: The sidebar carries its own fold control on the host that has no titlebar

Status: implemented

## Problem

`gnk web` gave the browser no way to collapse the session sidebar. The toggle existed exactly once, in `packages/client/ui-sidebar/src/client/Titlebar.tsx`, which occupies the layout service's `titlebar` slot — and `AppFrame.tsx:200` renders that slot only under `desktopHost`, the presence of the `greeneekDesktop` preload bridge. A `SidebarRoot.module.css` comment recorded the reasoning: the rail "reads cleaner without it", treating a second control as a duplicate affordance. That reasoning assumed the titlebar is always there. On the Web host it never is, so the assumption silently moved a desktop-only convenience into a missing feature, and three Web browser scenarios (`markdown-wide-table`, `rail-search-expand`, `schedule-after`) failed clicking a `Collapse sidebar` control that the shipped product does not render.

The layout service already owned the state and the action: `toggleSidebar()` mutates the layout store, and `SidebarRootComponentProps` already receives it. Nothing about the collapse mechanism was host-specific — only the button's seat was.

## Decision

**The frame tells the sidebar which host it is on.** `SidebarOwnerProps` gains `desktopHost: boolean`, passed at the existing render site in `AppFrame.tsx` alongside `collapsed` and `width`. It is the frame's own already-computed fact (`useState` over the preload bridge), not a new signal, and the sidebar column needs it because the column is the only remaining place the control can live.

**Exactly one control per host, decided by rendering rather than by hiding.** `SidebarRoot.tsx` renders the fold row only when `!desktopHost`. Desktop keeps its titlebar toggle at the window's inline start and gains nothing; Web gains the control in the column, icon-only in both widths so the collapse choreography never has to fade a label. `display: none` would have kept a second control in the accessibility tree on desktop, which is the duplicate the original comment objected to.

**The control drives the shared action and reports real state.** One `<button type="button">` calling the injected `toggleSidebar()`, with `aria-label` from the package's existing `toggle.collapse` / `toggle.open` keys and `aria-expanded` following the frame's `collapsed`. The rail geometry rule centers it in the 56px track like every other control box. No local state, no new service method, no duplicate store.

## Alternatives considered

**Rewrite the three browser scenarios to stop clicking the control.** Rejected: the owner directive for this defect names that move explicitly, and the tests were reporting a true gap in the product.

**Add a `Collapse sidebar` button to the Web top bar.** Rejected for this pass: `sidebar.topbar` is registered but no package occupies it in the shipped composition, so filling it would introduce a second chrome region to host one control when the sidebar column already owns the geometry it changes.

**Let CSS decide from `data-desktop-host`.** Rejected: the frame publishes that attribute on the grid for styling, but a hidden button stays focusable and announced, so the accessibility tree would carry two toggles on desktop.

## Verification

`pnpm exec vitest run packages/client/ui-sidebar packages/client/ui-layout` → 107 tests in 15 files pass, including `tests/fold-toggle.client.spec.tsx` (Web renders the control with the collapse name while open and the open name while collapsed, click reaches `toggleSidebar` once, desktop renders none, all three locales name it) and a new desktop-host snapshot case pinning the absence. The three Web browser scenarios now pass against built bundles: `CI=true GNK_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/{markdown-wide-table,rail-search-expand,schedule-after}.e2e.ts` → 14 tests in 3 files. `pnpm run typecheck` and `pnpm run lint` clean; the required owner prop forced four existing construction sites to state their host, which is why the Web bench now says so explicitly.

## Consequences

`SidebarOwnerProps` is a required-prop contract, so every construction site names its host: four existing test benches gained an explicit `desktopHost`, which makes the host each one pins readable instead of implied. The `sidebar` slot's owner share now carries a host fact, so a future host with its own chrome must decide the same question — who owns the fold control — rather than inheriting it silently.

Any Web ARIA golden that captures the sidebar column now includes the fold button, so the browser-lane expected files needed re-recording after this change; that re-record is a separate commit and its diff is exactly this control.

## Related

- [The CTC opt-in keeps its disposer](./2026-11-01-ctc-reversible-presentation.md)
- [Web styling](../../../../docs/web-styling.md)

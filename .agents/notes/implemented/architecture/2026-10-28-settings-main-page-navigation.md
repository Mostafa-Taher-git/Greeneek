# Agent Note: Settings is a main-column page

Status: implemented

## Problem

Settings was an `800px` modal mounted from the sidebar trigger. It masked the conversation, imposed dialog semantics on a multi-section management surface, and made the product feel like a utility panel rather than a first-class destination. The owner requested a full-page Settings experience while preserving an in-progress conversation.

## Decision

`ui-layout` owns the main destination as transient layout state: `mainPage` is `conversation` or `settings`, with an optional `settingsSection`. `ctx.layout` exposes `openSettings(section?)`, `selectSettingsSection(section)`, and `showConversation()` through the same bound-action attachment used by panel controls.

The root frame always keeps the conversation page mounted. It hides that page with `hidden` when Settings is active and mounts the `settings` single slot only for the Settings destination. Closing Settings unmounts the page and reveals the preserved conversation, including drafts, scroll state, and the active session.

`ui-settings-general` registers two occupants. The existing `sidebar.settings` entry owns the trigger and onboarding stage. A new `settings` entry owns the full-page shell, declares the header/action/close/section child slots, and renders a `main` landmark with the existing navigation rail and section host. The trigger and onboarding deep links call `ctx.layout.openSettings`; section navigation and close call the other layout actions.

The page keeps document-level Escape, entry focus on the close control, section fallback when a registration disappears, locale-reactive labels, and every existing settings section contract. It removes the mask, modal role, `aria-modal`, and `aria-expanded` trigger state because the surface is navigation, not a dialog.

## Alternatives considered

- **Keep the modal.** Preserves every existing mount path, but keeps the mask and dialog semantics the page exists to remove: a multi-section management surface is not a dialog over the conversation.
- **Unmount the conversation while Settings is open.** Simpler than the hidden-page swap, but it destroys drafts, scroll state, and the active session — the preservation the full-page contract requires.
- **Move the page shell into `ui-layout`.** Would split Settings chrome across two owners; feature packages contribute sections through one host, so `ui-settings-general` keeps the shell and `ui-layout` keeps only the destination state.

## Consequences

- A Settings visit never destroys conversation component state.
- A page reload still starts on the conversation; the destination is transient viewing state, like panel widths.
- Settings-only section subscriptions start when the page mounts and stop when it closes.
- The shared shell chrome remains owned by `ui-settings-general`; feature packages continue to contribute sections without knowing whether the host is a page or a dialog.

## Verification

- `ui-layout` tests cover destination transitions, slot owner props, and preserved conversation mount.
- `ui-settings-general` tests cover page semantics, section switching, Escape/close, onboarding deep links, empty and disappearing registries, and subscription lifetime.
- Browser settings scenarios target the `main` landmark and the page close path.

---
description: "Shell layout for the Web GUI: the AppFrame with a resizable sidebar and right panel, a fixed-size Thread Details popover, concession behavior, persisted panel preferences, the panel-geometry service, and theme presentation; for users and maintainers of the window chrome."
kind: "package-reference"
---

# @greeneek/gnk-client-ui-layout


## Summary

This package provides the shell layout of the Web GUI: a 52px titlebar row above an AppFrame with a resizable sidebar and right panel, a fixed-size Thread Details popover anchored under the toggle, a concession chain for the right panel, the terminal drawer track, and the `ctx.layout` panel-geometry service other plugins call to move panels. It also seats the theme presenter, which projects the resolved color scheme, alias tokens, content font size, and `theme-color` metadata onto the document. Choose it for the standard window chrome.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin at the root slot; it then renders the titlebar row and the app frame around whatever occupies the sidebar, conversation, details, right panel, and terminal drawer seats. Users resize the sidebar by dragging its invisible hit strip and the right panel by dragging its floating pill; Thread Details has no track and no resize affordance — its toggle opens a 280px card in a 300px wrapper, and a click outside the card and the titlebar toggles dismisses it. When the window narrows, the right panel shrinks and then auto-closes while staying mounted. A closed sidebar retains a 56px control rail.

A right panel whose preference is open is never silently lost: when the solver collapses its track the column floats over the conversation instead. Thread Details is always a popover and sits beside the right panel when that panel is open, so both remain visible. A closed panel is `inert`, `aria-hidden`, and `hidden`, which keeps its mounted controls out of the tab order and the accessibility tree until it opens again.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--gnk-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background. Disposing the presenter removes its metadata node with its other global writes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `register()` call contributes `AppFrame` into the runtime's built-in `'root'` slot and, in the same breath, declares the child slots (`titlebar`, `sidebar`, `conversation`, `settings`, `dashboard`, `details`, `rightbar`, `terminal.drawer`, `shell.overlay`), seats the layout store (panel geometry and visibility), and wires the `ctx.layout` panel-action service. The layout store starts from the sidebar default with the right panel and Thread Details closed and persists the panel preferences under `gnk.layout.panels.v2`; the current page still opens on the conversation. AppFrame renders the titlebar row on every host with the panel controls, document title, and current Session as its owner share, always mounts the conversation and the right column, and renders a session's Trajectory or Fleet through `SessionProvider`. Thread Details stays mounted as an out-of-flow popover; the right panel leaves the grid flow as an overlay when its preference survives a zero-width solve, and either surface takes `inert`/`aria-hidden`/`hidden` when closed. It projects the selected Session title over the build-configured product title or the localized `common.brand.localBuild` fallback, so locale revisions update document metadata with the root entry. The theme presenter is a second effect: pure DOM writes from resolved snapshots — initial state through the getter once, then event-driven only, with no React path. It applies palette, font-size, and token variables before measuring the rendered background as the single color authority.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the layout surface is not enough. They move from the frame to the columns it renders and the theme it presents.

- [ui-sidebar](../ui-sidebar/README.md) — occupies the `sidebar` column and its seats.
- [ui-conversation](../ui-conversation/README.md) — occupies the `conversation`, `details`, and `terminal.drawer` columns.
- [ui-theme](../ui-theme/README.md) — the theme seam whose resolved snapshots the presenter consumes.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current layout behavior. They are current package constraints, not a general window-manager comparison or a task backlog.

- **Panel preferences persist but the page does not** — a reload restores the sidebar and right-panel width and each panel's open state, then opens on the conversation regardless of the last page. Thread Details has no stored width.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the right panel either floats as an overlay or restores itself when the window widens; consumers must not read the stored width as the rendered truth. Thread Details never enters the concession chain.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The shell viewing-state store behind ctx.layout emits no cordis events; clamp/prune/concession-chain sequencing is asserted directly by this package's columns and service specs.

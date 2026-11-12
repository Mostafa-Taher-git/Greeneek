---
description: "Shell layout for the Web GUI: the four-column AppFrame with drag handles, concession behavior, persisted panel preferences, the panel-geometry service, and theme presentation; for users and maintainers of the window chrome."
kind: "package-reference"
---

# @greeneek/gnk-client-ui-layout


## Summary

This package provides the shell layout of the Web GUI: a four-column AppFrame (sidebar, center, Thread Details, right panel) with resizable side panels, a concession chain that shrinks the right panel and then Thread Details before auto-closing them, the terminal drawer track, and the `ctx.layout` panel-geometry service other plugins call to move panels. It also seats the theme presenter, which projects the resolved color scheme, alias tokens, content font size, and `theme-color` metadata onto the document. Choose it for the standard window chrome.

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

Mount this plugin at the root slot; it then renders the app frame around whatever occupies the sidebar, conversation, details, right panel, and terminal drawer seats. Users resize the sidebar by dragging its invisible hit strip and each right-side panel by dragging its floating pill; when the window narrows, the right panel shrinks first, then Thread Details, then both close. A closed sidebar retains a 56px control rail; the side panels close to zero width while staying mounted.

A side panel whose preference is open is never silently lost: when the solver collapses its track the column floats over the conversation instead, in preference order, so the right panel covers Thread Details. A closed side panel is `inert` and `aria-hidden`, which keeps its mounted controls out of the tab order and the accessibility tree until it opens again.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--gnk-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background. Disposing the presenter removes its metadata node with its other global writes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `register()` call contributes `AppFrame` into the runtime's built-in `'root'` slot and, in the same breath, declares the child slots (`sidebar`, `conversation`, `details`, `rightbar`, `terminal.drawer`, `shell.overlay`), seats the layout store (panel geometry and visibility), and wires the `ctx.layout` panel-action service. The layout store starts from the sidebar default with both right-side panels closed and persists the four panel preferences under `gnk.layout.panels`; the current page still opens on the conversation. AppFrame solves the four tracks from the viewport and those preferences, always mounts the conversation and both side columns, and renders a session's Trajectory or Fleet through `SessionProvider`. Side-panel collapse is symmetric: the same element leaves the grid flow as an overlay when its preference survives a zero-width solve, and takes `inert`/`aria-hidden` when the preference is closed. It projects the selected Session title over the build-configured product title or the localized `common.brand.localBuild` fallback, so locale revisions update document metadata with the root entry. The theme presenter is a second effect: pure DOM writes from resolved snapshots — initial state through the getter once, then event-driven only, with no React path. It applies palette, font-size, and token variables before measuring the rendered background as the single color authority.

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

- **Panel preferences persist but the page does not** — a reload restores each side panel's open state and dragged width, then opens on the conversation regardless of the last page.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel either floats as an overlay or restores itself when the window widens; consumers must not read the stored width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The shell viewing-state store behind ctx.layout emits no cordis events; clamp/prune/concession-chain sequencing is asserted directly by this package's columns and service specs.

# Agent Note: Tiled session panes

Status: implemented

## Problem

The frame had one conversation page and one persisted current session. Users wanted four or more live session pages side by side, with repositioning, resizing, and a layout that survives reload in Web and Desktop. The renderer binds session scope from `adapter.current` only, so native multi-scope rendering would require a framework extension point.

## Decision

`ui-layout` owns a `session.tiles` frame slot and an additive `shell.overlay` toggle. Each pane is a same-origin iframe of the app carrying `?tile=<id>&session=<id>`; the Client Sessions constructor reads those two query fields into a pane-scoped persisted selection key, so each iframe shows a different live session without changing the renderer or agent loop. The shipped layout is capped at four panes: the toggle seeds four and the Add gesture is disabled at that count. Normalized rectangle geometry lives in the root layout store under `gnk.layout.panels.v3` with clamped move/resize actions, reorder, close, and add; structural changes reflow panes on a two-column grid so they stay disjoint. Pointer capture drives header drags and corner resizes; the resize handle also accepts arrow keys and each iframe title identifies its pane or session. The store is shared by the frame, pane renderer, and toggle. The previous persist key is retired because whole-value rehydration cannot supply fields absent from an older document.

## Alternatives considered

Widening the renderer's staged session set and rendering conversation slots per pane would change the framework's scope binding and event ownership; that is a larger seam change than this UI feature warrants. A non-persisted local layout would fail the reload requirement.

## Testing

`packages/client/ui-layout/tests/session-tiles.client.spec.tsx` covers four panes, scoped URLs, pointer drags with clamping, reorder, close, and the overlay toggle; store specs cover persistence and min-size bounds. `packages/api/session-controller/tests/tile-selection.client.spec.ts` pins the pane-scoped selection key. `apps/web/tests/session-tiling.e2e.ts` verifies four live panes, drag geometry, and persistence in a fresh page of the same context, with `apps/web/tests/expected/session-tiling/geometry.expected.md` as the keyless golden. Both refresh and replay modes pass locally.

## Consequences

Tiled panes are independent browser documents sharing one origin and one settings store. Opening them changes the URL query, and changing a pane's session writes its own selection key. Desktop hosts the same client UI, so the feature applies there without a separate implementation.

## Related

[2026-07-20 GUI testing system](../process/2026-07-20-gui-testing-system.md)

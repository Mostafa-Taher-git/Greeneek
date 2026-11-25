# Agent Note: Tiled session panes removed

Status: implemented

## Problem

`ui-layout` shipped a four-pane tiled-session view in which each pane was a same-origin iframe carrying `?tile=<id>&session=<id>`, with persisted normalized geometry, pointer drag/resize, reorder, and a `session.tiles` frame slot. It was introduced to let users keep four live session pages side by side without widening the renderer's scope binding: the renderer binds session scope from `adapter.current`, so native multi-scope rendering would have required a framework extension point. A non-persisted local layout would not have survived reload. The owner withdrew the feature after deciding its complexity and UI cost were not justified by its use.

## Decision

Session tiling is absent from the product. Deleted: the pane renderer, toggle, both CSS modules, their client specs, the Web e2e and its golden, and the session-controller's pane-scoped selection test. The `ui-layout` store no longer carries tile geometry or actions, `AppFrame` no longer hosts the `session.tiles` slot, the locale dictionaries and slot catalog no longer name it, and the Web `tsconfig` no longer includes the tiling spec. `ClientSessions` uses only `gnk.sessions.current` again, with no `?tile`/`?session` query handling. The generated UI-layout API report and README were regenerated.

## Alternatives considered

Keeping the renderer but hiding the toggle would leave dead state and query handling in shipped code. Keeping a restricted two-pane mode would retain the same iframe-scope machinery the owner rejected. A renderer-level multi-scope extension would change framework event ownership for a feature that is no longer wanted.

## Testing

`packages/client/ui-layout` (76 tests), `packages/extensions/cordis-client-runner` (110 tests), and `packages/client/locale` (52 tests) pass; Web typecheck passes. A repository-wide search finds no `session.tiles`, `tilesActive`, `tileRectFor`, `SessionTile`, `TileToggle`, `SessionTiles`, `TILE_MIN`, or tile store action references outside this note.

## Consequences

The capability given up is side-by-side live session panes with persisted geometry; users keep the single conversation page and the existing sidebar/details layout. Reintroduction would need a fresh owner decision and a full reimplementation: the renderer scope binding has not been widened, and no durable or wire compatibility for tile data remains. `gnk.layout.panels.v3` persists only the ordinary panel widths and drawer state.

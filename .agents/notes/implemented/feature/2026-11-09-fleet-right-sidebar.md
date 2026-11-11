# Agent Note: Fleet moves to a dedicated right sidebar

Status: implemented

## Problem

The Army fleet lived as a `Tool | Fleet` tab inside the details column, so live agent work hid behind details-column arbitration and auto-open fought tool clicks. S5-11a requires a dedicated right-sidebar surface for live agent/fleet work, not a tab inside the details column.

## Decision

ui-layout declares a session-scoped `rightbar` slot over the shared details track, with store actions `openRightbar`/`closeRightbar`/`toggleRightbar` and the same face on `ctx.layout`. AppFrame renders `rightbar` while open and `details` otherwise, so the tool inspector keeps its home and the existing narrow-width concession chain keeps the composer pill as the fallback.

ui-wave registers `FleetSidebar` into `rightbar`, reusing the existing `FleetPanel` body verbatim beside the composer pill. The sidebar auto-opens on the empty→running edge, closes in one click from its header, and keeps the emergency stop at the top of the reused body while stoppable. The `conversation.details.fleet` tab registration is retired; the pill overlay still renders `FleetPanel` directly.

## Alternatives considered

- **Occupying `details` directly.** Would replace the tool inspector outright instead of sharing its track, losing the surface the plan keeps for tool calls.
- **A separate fourth column.** Doubles the concession-chain geometry; reusing the details track preserves the sub-1220 pill fallback without new breakpoints.

## Consequences

- Sees live waves without finding a tab; the manual close sticks until a new fleet starts.
- Narrow viewports collapse the shared track and leave the pill's emergency stop reachable.
- The ui-chat fleet-tab arbitration no longer has a production occupant.

## Verification

- Narrow `pnpm exec vitest run packages/client/ui-wave packages/client/ui-layout` — 140 passed.
- `pnpm exec tsc -b packages/client/ui-layout/tsconfig.json packages/client/ui-wave/tsconfig.json --force` — clean.
- New `fleet-sidebar.client.spec.tsx` pins auto-open on running, one-click close, and the emergency stop calling the roster stop.

# Agent Note: Deep-agent operator decision

Status: implemented

## Problem

The runtime already exposes a revisioned `decide` Remote for operator assessment of candidate Triggers, but the management page only listed Tickets, Decisions, and Triggers. An operator could not record an accept/reject decision from the surface, even though the runtime requires that decision to produce a Ticket.

## Decision

The Triggers tab now renders a reason field and Accept / Reject actions per Trigger. Each action calls the existing `deepAgent.decide` Remote through the injected client face and refreshes the page. Eligibility and outcome validation stay in the engine: the UI does not edit or delete system-produced records, and it does not bypass the decision rules. Tickets keep their existing stop / retry lifecycle actions.

## Alternatives considered

Adding Ticket or Trigger CRUD would contradict the append-only record design. Editing or deleting Decisions would undermine their audit role. Calling the engine directly from the browser would bypass the Remote and permission boundary.

## Testing

`pnpm exec vitest run packages/client/ui-deep-agent/tests/apply.client.spec.ts` — 2 passed / 2, including a new test that proves `decide` forwards the exact trigger id, accept flag and reason to the Remote. `pnpm run typecheck` exit 0. Real Web UI: Deep-agent Triggers tab renders with zero page errors; no Triggers are configured in this test home, so live decision execution awaits a source-provided candidate.

## Consequences

Operators can now perform the decision step the runtime already requires; record ownership and audit semantics remain unchanged.

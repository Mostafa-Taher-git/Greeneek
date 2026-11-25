# Agent Note: Wait for durable acknowledgement in one-shot report tests

Status: implemented

## Problem

`team.spec.ts > reports a successful one-shot result to the Lead exactly once` intermittently failed on a loaded CI runner: `durable(lead).pendingMessages` still held the settled member's report after `waitReceipt` returned. The mailbox writes the target-side `user/message` receipt first and acknowledges it on the Lead log in a later microtask (`observeSessionEvent` → `checkpointDelivered` → `team/message/delivered`), so waiting only for the receipt samples a window where the report is still pending.

## Decision

`waitReceipt` now waits for both the receipt and the absence of that message id from `durable(lead).pendingMessages`. The delivery acknowledgement is a documented part of "the report reached the Lead"; waiting for it makes the inbox assertion deterministic. No assertion was relaxed and no product timing was changed.

## Alternatives considered

Polling only the `team/message/delivered` event would duplicate the projection's delivery definition in the test. Making the acknowledgement synchronous would change the mailbox's transaction-ordering contract for every consumer.

## Testing

The named test passes 5/5 targeted runs; the full `team.spec.ts` passes 3/3 runs and under `--coverage` (92 tests each run).

## Consequences

Team mailbox tests no longer race the acknowledgement, so a green local run matches the delivered state CI asserts.

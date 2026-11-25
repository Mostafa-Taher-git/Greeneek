# Agent Note: Clean rejection for late SDK initialize

Status: implemented

## Problem

A queued SDK `initialize` can reach `HarnessSdkJsonRpcServer` after its serving fiber has been disposed. Mounting the Greeneek LLM adapter then throws Cordis `INACTIVE_EFFECT`, which the JSON-RPC transport serializes as an opaque internal error.

## Decision

`initialize` catches `CordisError` from the adapter mount and reports a protocol-level error naming the inactive context. If the process root already owns an LLM service, the handshake proceeds with that service; otherwise it fails with an explicit message. The adapter mount itself is unchanged for active contexts.

## Alternatives considered

Retries inside the server would recreate effects on the same dead fiber. Reusing `ctx.root` for every server change was tried and did not clear the late-handshake failure, so it was not kept.

## Testing

`pnpm exec oxlint packages/sdk/server/src/server.ts` and `pnpm run typecheck` pass. The SDK snapshot replay still rejects the late handshake, but with the explicit error rather than an internal Cordis code.

## Consequences

SDK clients receive a stable, diagnosable failure when a handshake arrives after shutdown; no internal Cordis error code escapes over the wire.

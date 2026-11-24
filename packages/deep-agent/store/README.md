---
description: "Deep-agent authoritative SQLite store with versioned schema, atomic repositories, durable effects and outbox receipts"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-store

## Summary

`gnk-deep-agent-store` is the authoritative persistence boundary for Deep-agent. It owns one SQLite file with a monotonic schema version, owner-only file creation, WAL journaling, generated working-set columns, and SAVEPOINT-backed nested transactions. It exposes the same `Repositories` port as the in-memory core implementation, plus durable effect and outbox tables for restart recovery.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent persistence boundary

#### What the model sees

Nothing from this package enters a Greeneek model request. The SQLite store owns durable records behind `Repositories`, queued `Effects`, and outbox receipts; the runtime projects authorized facts into model-visible `Session events`.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **Single writer** — one connection per store instance; cross-process ownership is enforced by the runtime's state-directory lock.
- **No legacy migration** - Deep-agent ships no prior data; a stored version outside the accepted range is refused.

### Dev Note

No companion invariant is published: the SQLite connection and its repositories have one owner, so schema and transaction behavior are asserted by store behavior specs.

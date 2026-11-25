---
description: "Deep-agent pure domain model and transactional event engine, adapted from the reference superagent prototype"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-core

## Summary

`gnk-deep-agent-core` owns Deep-agent's domain vocabulary: Source, Trigger, Thread, Eval, Decision, Ticket, Mandate, Assignment, Executor, Subscription, Channel, Policy, Input, and Report. It provides deterministic content-derived ids, ticket stage classification, in-memory repositories with nested rollback, and the Engine that implements the Source → Trigger → Thread → Eval → Decision → Ticket → Assignment → Executor → Report pipeline. The domain is host-independent and performs no I/O; all side effects are queued through ports.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent domain core

#### What the model sees

Nothing from this package enters a Greeneek model request. The `Engine` mutates durable domain records through `Repositories` and queues effects through ports; the runtime package projects authorized facts into model-visible `Session events`.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **Host-independent** — Source adapters, SQLite persistence, worker execution, and the management panel are owned by separate packages.
- **Reference provenance** - domain names and rules are adapted from the MIT-licensed reference superagent prototype; the original copyright notice is preserved in the group README.

### Dev Note

No invariant companion is published: the `Engine` and in-memory `Repositories` share one owner, so rollback behavior is covered by domain tests rather than a separate runtime check.

---
description: "Deep-agent GitHub and Discord source adapters with durable cursors, bot filtering, health and idempotent outbound replies"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-sources

## Summary

`gnk-deep-agent-sources` ingests GitHub and Discord events into the Deep-agent domain. Each adapter resolves its credential per call through Greeneek's credential service, persists read cursors in the Deep-agent store, filters bot and unlisted actors, correlates messages into Threads, and posts replies with stable idempotency keys. A registry polls adapters and delivers queued replies with retry.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent source adapters

#### What the model sees

Nothing from this package enters a model request directly. It produces `ctx.remote.deepAgent.receive`-shaped Triggers whose text is untrusted external content; the Router card labels that text as external data.

#### Token effect

Zero direct tokens. The adapters add no system-prompt or tool-schema content.

#### KV Cache effect

None; the adapters neither assemble nor send provider requests.

## Known Limitations and Deferred Work

- Polling uses REST only; GitHub webhooks and Discord gateway events are not subscribed.
- Reply delivery retries in memory while the registry is alive; a restart re-enqueues from the durable outbox in the runtime.

### Dev Note

No invariant companion is published: adapters own their own polling and reply state, and the runtime owns the durable outbox they hand off to.

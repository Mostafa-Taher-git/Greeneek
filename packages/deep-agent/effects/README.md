---
description: "Deep-agent durable effect queue with coalescing, bounded backoff, ordering and restart recovery"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-effects

## Summary

`gnk-deep-agent-effects` dispatches the six Deep-agent effect kinds (`assessment`, `launch`, `delivery`, `relay`, `notice`, `reply`) from durable SQLite rows. Enqueue coalesces by `(kind, key)` while preserving queue position; failures back off exponentially up to a per-kind cap; ordered kinds run behind their oldest row; and a `Later` signal defers without consuming a failure. Rows survive restart because they live in the authoritative store.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent effect queue

#### What the model sees

Nothing from this package enters a Greeneek model request. The `EffectQueue` invokes application handlers for durable `Effects`; any model-visible content is projected by the runtime through `Session events`.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **Single dispatcher** — one drain runs at a time; per-kind limits bound concurrency but the queue itself is not distributed.
- **Handler registration is runtime-owned** - reopening a store does not re-register handlers; the runtime must attach them on boot.

### Dev Note

No invariant companion is published: the queue owns its single dispatcher and store rows, so handler registration and drain order are asserted by queue behavior specs.

---
description: "Deep-agent Host runtime owning the domain store, engine, effects, policy and management Remotes"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-runtime

## Summary

`gnk-deep-agent-runtime` is the Deep-agent Host service (`ctx.deepAgent`). It owns the authoritative SQLite store, the domain Engine, the durable effect queue, and the versioned policy. It exposes read Remotes for the management panel and control Remotes for stop and retry. The runtime is independent of Maestro, Fleet, and the subagent seam.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent Host runtime

#### What the model sees

Nothing from this package enters a Greeneek model request directly. The runtime owns domain state; a later phase projects authorized facts into Router and Worker Session events through `ctx.agents`.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **No Worker sessions yet** — effect handlers for launch, delivery, and assessment are registered as placeholders; real `ctx.agents` execution is a later phase.
- **No Source adapters yet** — GitHub and Feishu providers are not wired; Trigger ingestion is available through the Engine but no external Source runs.
- **Read-only policy** — policy settings are supplied at boot; panel-driven settings edits are deferred.

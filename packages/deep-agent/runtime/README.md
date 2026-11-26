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

- **Record management is read-only in the panel** — Tickets, Decisions, and Triggers are produced by Trigger ingestion and evaluation; editing or deleting them from the surface is deferred.
- **Discord ingestion needs a bot token** — the Discord source polls the guild channels named in settings; unit coverage injects HTTP responses instead of a live credential.
- **Feishu is out of scope** — Discord is the chat integration; the runtime wires GitHub and Discord sources only.

### Dev Note

No invariant companion is published: the runtime is the sole owner of the store, engine, and effect handlers it wires, so its lifecycle is covered by runtime behavior specs.

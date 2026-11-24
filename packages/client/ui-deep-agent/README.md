---
description: "Deep-agent standalone management page and permanent sidebar entry backed by Host Remotes"
kind: "package-reference"
---

# @greeneek/gnk-client-ui-deep-agent

## Summary

`gnk-client-ui-deep-agent` contributes the Deep-agent standalone main-column page and its permanent sidebar entry. The page renders real Host state through generated Remotes: an operational overview, Tickets, Decisions, and Triggers, with stop and retry actions. It uses Greeneek design tokens and typed zh/en/ar dictionaries.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent management page

#### What the model sees

Nothing from this package enters a Greeneek model request. It presents Host-owned Deep-agent state through `ctx.remote.deepAgent`; the runtime owns any projection into model-visible Session events.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- Worker sessions, source adapters, and prompt management are not exposed in this phase; the page shows only the state the current Host runtime persists.

### Dev Note

No companion invariant is published: the page is a pure projection of Host-owned Remotes and holds no independent runtime state to compare.

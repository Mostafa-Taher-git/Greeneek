---
description: "Deep-agent versioned authorization policy with admission matrix, gate, mandate revalidation and assessment rules"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-policy

## Summary

`gnk-deep-agent-policy` decides who may originate Deep-agent work. It implements the reference admission matrix, the accept modes `off`/`observe`/`auto`, a version hash over authorization-relevant settings, per-Source allowed actors and bots, and mandate revalidation. A message is never interpreted as permission for unrestricted action; a Ticket carries its authority in its Mandate.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent authorization policy

#### What the model sees

Nothing from this package enters a Greeneek model request. The `Policy` gate returns admission results and mandate revalidation decisions used by the domain `Engine`; the runtime records audit reasons in `Decisions`.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **Settings are supplied by the runtime** — this package validates and evaluates them; persistence and panel editing belong to the runtime and client packages.
- **Names are case-insensitive** - source actors are compared with a normalized name, matching the reference `sameName` behavior.

### Dev Note

No invariant companion is published: policy evaluation is a pure function of the supplied settings and domain records, with no independently observable state to compare.

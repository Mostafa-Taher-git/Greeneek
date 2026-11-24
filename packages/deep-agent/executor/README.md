---
description: "Deep-agent real Worker execution through ctx.agents: slots, isolated sessions, delivery, reports and restart recovery"
kind: "package-reference"
---

# @greeneek/gnk-deep-agent-executor

## Summary

`gnk-deep-agent-executor` implements the domain `Executor` port with real Greeneek agents. Each Assignment gets one owned `AgentHandle`, an isolated working directory, a mandate prompt scoped to that agent, and a scoped `deep_agent_report` tool. A slot registry enforces concurrency. Delivery uses `agent.followup`, cancellation uses `agent.cancel`, and restart recovery uses `ctx.agents.resume` with the deterministic Worker session id and a recovery note.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Deep-agent Worker sessions

#### What the model sees

A Worker receives its Ticket title, immutable Mandate strength and basis, actor, and a report instruction as its first model-visible prompt through `ctx.agents`. That text is logged in the Worker's Session, so the request is reconstructable from the session log.

#### Token effect

The mandate prompt adds one bounded user-role message per Worker session; there is no global system-prompt contribution.

#### KV Cache effect

Each Worker session has its own prefix, so mandates do not invalidate another session's cache. Reusing a session id after restart extends the same prefix.

## Known Limitations and Deferred Work

- Recovery resumes only assignments already marked running; interrupted launches are re-enqueued by the runtime, not by this package.
- The Worker preset is optional; without one the agent uses the deployment default preset.

### Dev Note

No companion invariant is published: slot accounting and assignment recovery have one owner in this package and are asserted by executor behavior specs.

---
description: "The Army wave engine (ctx.waves): concurrent one-shot subagent fleets with budgets, engine-owned cancellation, and browser fleet views."
kind: "package-reference"
---

# @greeneek/gnk-subagent-wave

## Summary

`gnk-subagent-wave` is the wave engine behind Army mode (`ctx.waves`): one Lead agent admits a `WaveRequest`, the engine launches every member as a one-shot subagent through `ctx.subagents` under a shared concurrency cap, meters per-member and per-wave token budgets at `agent/pre-step`, owns each member's `AbortController` from admission, and settles deterministic spec-order results. The browser faces ride the Typert `@Remote` surface: list, cancel one member, cancel a wave, and the emergency stop. Choose it when composing a fleet-delegation profile; the model-facing Lead tool is a separate Consumer package.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package with the subagent seam (`@greeneek/gnk-subagent`), at least one provider, and a Lead-side Consumer (the Army tool package). Budget metering additionally requires `@greeneek/gnk-token-meter`; without its `tokenUsage` projection the engine keeps budgets unset and metering off.

### Minimal composition

```yaml
- name: '@greeneek/gnk-subagent'
- name: '@greeneek/gnk-subagent-spawn-in-process'
- name: '@greeneek/gnk-subagent-wave'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxConcurrent` | 8 | Simultaneously launched members across all waves; ceiling 16 |
| `maxResultBytes` | 16384 | UTF-8 byte cap applied to one member's settled output and structured value |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

**Member dispatch.** `startWave` validates providers against the live registry, mints one engine-owned `AbortController` per member at admission, and dispatches every member onto a shared counting semaphore. A release hands its slot directly to the oldest live waiter, so queued members never race a fresh start past the cap. The concurrency slot frees only after the published run's `dispose()` settles, bounding live children rather than launches.

**Cancellation.** Because the controller exists before `ctx.subagents.start` fulfills, a cancel reaches a member in any phase: a queued member settles `cancelled` without launching, a launching provider rejects into `cancelled`, and a published child observes the signal through its request. `WaveMemberId` is engine-minted for exactly this reason — the seam's `SubagentRunId` exists only after publication.

**Budget kill.** A global `agent/pre-step` listener resolves the stepping agent through the child-session index and reads cumulative usage from the `tokenUsage` session projection (O(1), eager-driven). A breach marks the member budget-killed, vetoes the step with `{ kind: 'reject' }`, and aborts its controller. Wave aggregate spend sums every member's latest reading.

**Settlement.** Terminal status prefers `budget-killed`, then cancellation, then the seam's stop reason. Fail-fast (`onComplete: 'fail-fast'`) triggers only on a failed or budget-killed *launched* member — a user cancel never does. Results return in spec order with text truncated (never split mid-codepoint) and an over-cap `structured` value dropped, each recorded as `truncated: true`. Closed waves stay listed until their Lead agent's `agent/disposed`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Army Lead tool Consumer, which registers the fleet-delegation tool whose schema and results this engine serves.

#### KV Cache effect

None of its own; only the Lead tool's registration and the wave results it logs change model-visible content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Budgets need the meter** — With `maxTokensPerMember`/`maxWaveTokens` set but no `tokenUsage` projection mounted, metering reads zero and no kill fires; the deployment is misconfigured, not enforced loosely.
- **In-process fleet only** — Members run through registered subagent providers; the engine adds no transport of its own, so remote fleets depend on a provider that speaks one.
- **No durable wave record yet** — Wave membership and budgets are process-local until the fleet Session events land; a restart mid-wave cancels by teardown.

<details>
<summary>Runtime invariant omission</summary>

**Runtime invariant:** No companion is published because every owned relationship here (semaphore slot ↔ live member, child index ↔ published run) is observable through one `WaveRuntime` instance's own views, so independent observations cannot diverge across services.

</details>

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

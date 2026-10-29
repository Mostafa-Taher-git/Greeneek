---
description: "Web Army fleet surfaces: the details-panel Fleet tab and the composer pill, polled from the wave engine's browser control face; for users and maintainers of fleet delegation."
kind: "package-reference"
---

# @greeneek/gnk-client-ui-wave


## Summary

This package renders the Army fleet of the Web GUI: one body in the details panel's Fleet tab and one compact pill beside the composer, both reading the same live mirror of the Lead session's waves. The engine keeps member progress in host memory and publishes no event for it, so this package samples the `waves` Remote face — once a second while a wave is unclosed, and every five seconds while the fleet is settled — and issues no other RPC. Accepted samples reach the surfaces through an 80 ms coalescing window, so a burst is one render. The pill appears only when the session lists a wave, counts the members a stop could still reach, and carries the emergency stop on itself; the tab offers the full rows.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin with the host `waves` service ([`gnk-subagent-wave`](../../subagent/wave/README.md)) and the Army preset. A Lead session then shows its fleet wherever the reader looks:

- **Fleet tab** — while this surface is mounted, the details column grows a `Tool | Fleet` tab row. A Tool-row click returns the panel to the Tool body; the Fleet tab is one click back, and it says so when the session has no wave.
- **Composer pill** — below the width where the details column collapses, the pill names the newest open wave, counts cancellable members, and opens the same rows in an overlay above the composer. Escape, the close control, and a pointer outside all dismiss it.
- **Stops** — one button per member while it is queued or running, one per open wave, and an emergency stop that aborts every unsettled member of every wave this session owns. The mass cancel needs two clicks and disarms after five seconds.
- **Resume** — a closed wave that lost a member to a budget kill shows a resume card naming the exact remaining members, with per-member and wave budget fields; the action stays disabled until at least one positive budget is entered, and the card disappears once the wave carries its resumed-to mark. The card rides the shared panel body, so the pill's overlay offers it too.
- **Rows** — one line per member: role, model, status, the last tool it dispatched, its settled duration, its artifact count when the member's settled result named validated pointers (each address in the hover title), and its spend — read against the wave's member ceiling when the engine admitted one, else the plain token count. A member that did not complete keeps its diagnostic on the row.
- **Transcripts** — a member that published a child session opens it read-only through the subagent transport.

A stopped or failed member keeps its row with its status and diagnostic; a fleet whose samples stopped arriving keeps its last rows and says the view is stale instead of emptying.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

**One mirror per Lead session.** `apply` keeps a `FleetMirror` per Session id and hands the same instance to both registrations, so one sampled fleet backs the tab and the pill. The mirror is a bare observable in the reserved `hooks` compartment; the renderer binds it to `useFleet`, and no component sees the source or a timer.

**Sampling follows attention.** The loop starts when the first surface subscribes and stops when the last one unsubscribes, so a session nobody is looking at pays no RPC. An in-flight sample collapses a second request, and a sample is accepted only when a rendered field moved — closed flags, a wave's resumed-to mark, member status, tokens, budget reading, ceiling, last tool, duration, child session, artifact pointers, or diagnostic — because the Remote builds fresh views on every call and reference equality would re-render the fleet once per second.

**Accepted samples coalesce.** The mirror keeps the newest accepted snapshot and flushes it to subscribers at most once per 80 ms, so a burst — several attention polls, several stop verbs, or a future pushed source — is one render, and the trailing flush publishes the last accepted sample rather than an intermediate row. The poll cadence is unchanged, and `degraded`/`loading` ride the same snapshot: a rejected sample still publishes its stale notice once per window instead of once per attempt.

**Verbs answer, then resample.** `stopAll`, `stopWave`, `stopMember`, and `resume` call their Remote endpoint and schedule an immediate sample, so the abort or the resumed wave's admission shows without waiting for the next tick. The resume answer is the admission — the resumed wave's id — and its progress arrives through the polled rows, not the call.

**The panel owns no fleet knowledge.** `conversation.details.fleet` is a child slot that ui-chat declares and ui-wave occupies. ui-chat's tab row reads that slot's occupancy through the slot registry's own change feed, which is the only fact Chat needs: it never imports this package's values or types.

**Child transcripts ride the seam.** A wave member is a one-shot subagent, so opening it calls `ctx.sessions.openSubagent` with `mode: 'one-shot'` — the same read-only transport the subagent catalog uses.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [gnk-subagent-wave](../../subagent/wave/README.md) — the engine whose `@Remote` face this package polls.
- [gnk-tool-wave](../../subagent/tool-wave/README.md) — the Lead-facing `wave_dispatch` and `wave_cancel` tools.
- [ui-chat](../ui-chat/README.md) — the details panel that hosts the Fleet tab.
- [api/remotes](../../api/remotes/README.md) — the Client assembly that mounts the `waves` namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-computed fleet state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current fleet surfaces. They are current package constraints, not a general fleet-UI comparison.

- **Rows are as fresh as the last sample** — member status, last tool, and token spend move between samples, up to one second plus the coalescing window behind while a wave runs. The engine publishes no Remote event for member progress, so a pushed fleet view waits on that seam.
- **Lead activity is not listed** — the Fleet tab shows the waves this session started, not what the Lead itself is doing; that stays in the conversation.
- **Artifact pointers render as a count** — a settled member's row shows how many validated pointers its structured result named, with each address in the hover title; the row carries no per-artifact listing or open action.
- **Rows are not virtualized** — a wave's members are bounded by the engine's roster, so the list is short by construction; a fleet that outgrows that assumption needs windowing here.
- **No member reordering or grouping** — waves render in acceptance order and members in dispatch order, which is the order the Lead's result reports.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package is a sampled projection of one Remote namespace onto two slot entries. It owns no cross-plugin mutable state beyond the per-session mirror, emits no cordis events, and its registrations prove disposal through the fiber-teardown spec.

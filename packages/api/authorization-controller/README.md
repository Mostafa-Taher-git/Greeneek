---
description: "Host Remote owner for the authorization surfaces over the authorization seam: flows, attempt streams, prompt answers, and cancellation."
kind: "package-reference"
---

# Authorization Controller


## Summary

`@greeneek/gnk-api-authorization-controller` exposes the generated `ctx.remote.authorization` namespace for browser sign-in surfaces. It lists the registered authorization flows, runs one attempt per call as a stream of notices, prompts, withdrawals, and the final settlement, answers prompts by id, and cancels running attempts. When the authorization seam is absent, the namespace remains registered and reports an actionable configuration error.

## Table of Contents

- [One attempt, one stream](#one-attempt-one-stream)
- [Credential hygiene](#credential-hygiene)
- [Adding it to your composition](#adding-it-to-your-composition)
- [Source map](#source-map)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----


<a id="one-attempt-one-stream"></a>
## One attempt, one stream

An attempt is a Remote **stream**, not a forwarded event. Opening `attempt(key, method, signal)` runs the flow on the Host and yields frames in the order a page renders them: `notice`, `prompt`, `prompt-withdrawn`, and the terminal `settled` (`authorized` or `cancelled`). A page answers a prompt through `answer(key, promptId, answer)` under the id the frame carried, and cancels by aborting the stream: the carrier's signal is the request signal the seam withdraws through.

Streams instead of forwarded events because an authorization prompt is host-global — it names no Agent — and a forwarded waterfall requires an Agent identity to route to a page. The seam's per-attempt `AuthorizationInteraction` therefore rides the stream queue, and the prompt signal a flow retires (a typed code losing a race to a browser callback) surfaces as a `prompt-withdrawn` frame.

Failures end the stream in error with the controller's codes: `authorization/no-flow` (no flow claims the key, or it offers no such method), `authorization/in-flight` (a second attempt for a busy key), `authorization/no-prompt` (an answer names a prompt that is not, or is no longer, in flight), and `authorization/failed` (the flow itself failed). A malformed `scope/id` key is refused as `gateway/bad-request`, and an absent authorization seam reports `gateway/internal`.

## Credential hygiene

Secret values never cross this namespace in either direction. The record key travels as its `scope/id` wire string and is parsed back to a branded `CredentialKey` at the controller; the flow commits the credential through the record store, and the namespace only ever reports that a commit happened.

## Adding it to your composition

The web-app bundle mounts the controller as `authorization-controller`; a composition that already mounts the authorization seam needs only the plugin row:

```yaml
- id: authorization-controller
  name: '@greeneek/gnk-api-authorization-controller'
```

The client face mounts the generated contribution through `@greeneek/gnk-api-remotes/client`, which also re-exports the wire vocabulary (`AuthorizationEntryView`, `AuthorizationAttemptFrame`, `AuthorizationAnswer`, and the failure codes).

## Source map

| File | Purpose |
| --- | --- |
| `src/authorization.ts` | The controller: namespace methods, the attempt-stream bridge, prompt bookkeeping, and the refusal mapping |
| `src/types.ts` | Wire-safe views and the domain failure codes, without cordis/service imports |

-----

<a id="model-experience"></a>
## Model Experience

None, as this package carries human-driven sign-in flows to the browser and contributes nothing to a model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **An absent seam reports at call time** — with no authorization seam composed, the namespace still registers and every method reports an actionable configuration error; the composition owns adding the seam.
- **One attempt per key** — a second attempt for a busy key is refused with `authorization/in-flight`; attempts are neither shared nor queued.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The authorization seam owns flows and stored attempts; this package only carries their Remote faces onto the wire.

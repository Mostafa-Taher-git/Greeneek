---
description: "The single network egress policy of the Greeneek Harness: no provider is blocked by default, plus an optional strict allow-list for air-gapped deployments."
kind: "package-library"
---

# @greeneek/gnk-egress


## Summary

The harness blocks no provider by default: the operator chooses every endpoint, and every public host those endpoints name is reachable. `gnk-egress` owns that policy in one place. Connection-resolving seams call `assertEgressAllowed(url)` while they assemble a request's facts — before any adapter holds a URL — so a refused endpoint fails at boot with a readable `EgressBlockedError` config error instead of mid-stream. The blocklist is empty by policy and stays as the single override point for deployments that need one; matching runs first and can never be allow-listed. Under `$GNK_STRICT_EGRESS=1` the allow-list arm additionally refuses every host not on the built-in list. It is a zero-dependency library that product packages import directly; a `cordis.yml` cannot load it.

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

Guard every endpoint a configuration surface can steer network traffic toward, at the moment the policy for that endpoint is resolved.

### Guarding a resolved endpoint

```ts
import { assertEgressAllowed } from '@greeneek/gnk-egress'

// Inside a provider/options resolver: validate the base URL and each
// materialized per-model URL before constructing anything network-facing.
declare const options: { baseURL: string }
const baseURL = options.baseURL
assertEgressAllowed(baseURL)
```

### Tightening to an allow-list

```sh
GNK_STRICT_EGRESS=1 gnk ...
```

With the flag set, only hosts on `STRICT_ALLOWED_HOSTS` pass — the harness ships no built-in entries, so every endpoint is user-configured; everything else fails with the same `EgressBlockedError`.

## Understand the implementation

One module holds the whole policy. A URL is parsed once; a non-absolute or unparseable input is refused immediately so a caller never sees a bare `TypeError` instead of a config error. The hostname is matched against the blocklist first — empty by default, so nothing is refused there — and only then does strict mode consult the allow-list. `EgressBlockedError` carries the offending `hostname` so resolvers can render it into their own error surface.

## Further Exploration

- [Egress specs](tests/egress.spec.ts) — the open-by-default contract, strict mode, and the unparseable-input contract.
- [Migration guide](../../../docs/migration-from-deepseek.md) — what operators must change after the rebrand.

-----

<a id="model-experience"></a>
## Model Experience

### Egress refusal at boot

#### What the model sees

Nothing mid-turn — the guard fires while policy is being assembled, before any provider call. A configured agent observes the run refuse to start with an `EgressBlockedError: Egress blocked for <host>: …` config error instead of any model output.

#### Token effect

None. A blocked endpoint never issues a request, so no prompt is ever tokenized.

#### KV Cache effect

None — no request-prefix change is observable because the request does not exist.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what this library deliberately does not do. They are current package constraints, not a task backlog.

- **Resolution-time only** — the guard validates endpoints as policies are assembled; it does not intercept `fetch` at runtime, so a dependency that constructs its own URLs is checked by whoever resolved them, upstream.
- **Host-level matching** — block and allow decisions are made on hostnames, never paths or ports; a host cannot be half-allowed.
- **Fail-closed parsing** — a relative or malformed URL is an error, not a pass; callers that legitimately hold a bare path must resolve it against an absolute endpoint before guarding.
- **The strict allow-list is brand-scoped** — `GNK_STRICT_EGRESS` currently encodes the gateway deployment family; third-party BYOK endpoints are expected to run under the blocklist arm, not strict mode.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

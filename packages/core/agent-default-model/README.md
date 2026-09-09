---
description: "The deployment default model selection for users and maintainers choosing, configuring, or debugging which model freshly created agents start on."
kind: "package-reference"
---

# @greeneek/gnk-agent-default-model


## Summary

`gnk-agent-default-model` supplies the deployment's default model selection — provider, model, and optional reasoning effort — that agent entry points apply when a fresh session has no selection of its own. Direct entry points such as `gnk --profile headless` and Host-backed entry points read `ctx.agentDefaultModel` instead of owning parallel defaults, so one composition entry controls which model new agents start on. A mounted settings provider layers the user's choice over the composition entry, and a saved change is visible on the next read. It is one process-wide default: per-session model selection remains the entry point's responsibility. Choose it when you want a single place to set the model new agents use.

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

Mount this package wherever agents are created without an explicit model route. The service answers one question — which model should a fresh agent use? — so entry points that create agents consult it instead of re-implementing a default.

### Configure the default

The composition entry is the base of the default. Both fields are optional: a deployment that ships no provider of its own pins nothing, and the default becomes whichever route the user's own key activates. The entry stays usable without any settings provider.

```yaml
- name: '@greeneek/gnk-agent-default-model'
  config:
    provider: openai
    model: gpt-5
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | optional | Registered provider route for fresh agents; omitted defers to the user's configuration |
| `model` | optional | Provider-owned model id for fresh agents; omitted defers to the user's configuration |

The generated [configuration catalog](../../../docs/config-catalog.md#greeneekgnk-agent-default-model) is the exhaustive source for every accepted field. `reasoningEffort` is deliberately not a config field: it belongs to the settings layer, so a complete saved selection can clear an effort when the next selected model has none, while a composition value would be inherited again.

### Read and change the default

`currentSelection()` returns the *configured* default as a detached `{ provider, model, reasoningEffort? }`, or `undefined` when no layer names a complete pair. `resolveSelection()` is what an entry point creating an agent should call: it returns the configured default when one exists, and otherwise the first model of the first registered provider route — so a deployment that pins nothing becomes usable the moment the user supplies a key. `saveSelection()` stores the complete selection for later agents.

```text
const configured = ctx.agentDefaultModel.currentSelection() // ModelSelection | undefined
const selection = await ctx.agentDefaultModel.resolveSelection() // ModelSelection | undefined
await ctx.agentDefaultModel.saveSelection({ provider, model, reasoningEffort: 'high' })
```

A `resolveSelection()` of `undefined` means no route can serve a request yet: the caller should report that the user needs to configure a provider, rather than substituting a placeholder route. Without a settings provider, `saveSelection()` is a no-op and the composition entry remains current. The service does not validate catalog membership: a provider route may serve an unadvertised model, and the consumer that opens a model request owns availability diagnostics.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the service realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The service is a composition entry with a settings-backed source. The plugin config supplies the optional base `{ provider?, model? }`; when a settings provider is mounted, the `agent-default-model` settings section becomes the live source and every consumer reads through `currentSelection()`, so a settings write needs no registration-level rebuild. `reasoningEffort` lives only in the settings schema — the config cannot carry it, because an effort cleared by a new selection must stay cleared rather than being re-inherited from composition.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `AgentDefaultModelConfig` service, settings section install, `currentSelection`/`resolveSelection`/`saveSelection` |
| — | No runtime invariant companion is published; settings validation owns the only mutable-value relationship. |

### Behavior notes

`currentSelection()` and `saveSelection()` are thin reads and writes over that source: the former returns a fresh detached object so a caller can hold it without aliasing service state, and reports a section naming only one half of the route as no selection at all. `resolveSelection()` adds one live read of the adapter registry — deliberately live rather than captured at mount, because routes come and go with the settings document — and and `saveSelection()` writes the whole selection through `ctx.settings` when present.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The package-level contract is enough for most consumers; read these when you need the surrounding domain.

- [Core subsystem](../../../docs/subsystems/core.md) — the `Agent` handle and `AgentOptions` route selection.
- [agent-loop package](../agent-loop/README.md) — how agents resolve provider and model at request time.
- [Generated configuration catalog](../../../docs/config-catalog.md#greeneekgnk-agent-default-model) — every accepted config field and its source declaration.
- [Core group map](../README.md) — how the core packages compose.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `ModelSelection` the service supplies to an entry point; request assembly and the provider adapters own the model-visible request.

#### KV Cache effect

Changing the default affects only agents that subsequently resolve from it. An existing session whose request log already names a selection keeps that selection, so this service does not invalidate its established prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the service's scope. They are current package constraints, not a task backlog.

- **One process-wide default** — the service owns a single default; per-session model selection remains the entry point's responsibility.
- **No retention without a settings provider** — `saveSelection()` cannot keep a selection for a later agent when no settings provider is mounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

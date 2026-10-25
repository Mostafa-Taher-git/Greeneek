---
description: "The model-facing Craft gateway: craft_list_apps and craft_open_app stay mounted while no app is active, opening an app mounts its curated tools and recipe skill, and every reported artifact path is confined to the job root."
kind: "package-reference"
---

# @greeneek/gnk-tool-craft

## Summary

`gnk-tool-craft` is the Consumer half of the Craft capability seam. It registers exactly two model-facing gateway tools — `craft_list_apps` and `craft_open_app` — so an idle session pays two tool schemas and zero app processes. Opening an app mounts that app's curated meta-tools under the shared `mcp__<app>__<tool>` naming contract and loads its recipe as a runtime skill; closing disposes both and releases the child process. Results carrying artifact paths are confined against the job write root before the model ever sees them.

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

Compose it with the service and a host provider; the gateway needs `craft`, `skills`, and `tools`.

```yaml
- name: '@greeneek/gnk-craft'
- name: '@greeneek/gnk-craft-local'
- name: '@greeneek/gnk-tool-craft'
```

No configuration. The tool surface, app roster, and concurrency limit come from the manifests and `@greeneek/gnk-craft`'s `maxActiveApps` config. This composition is desktop-profile only: the headless Craft bridge is not mounted in web or remote deployments.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

`apply()` registers the two gateway tools as one effect and owns the active-app map. `craft_open_app` resolves the manifest, delegates to `ctx.craft.open`, then registers the manifest-filtered bridge (`registerAppTools`, reusing `matchesToolFilter`/`publicToolName` from `gnk-mcp-client`) and the recipe skill (`registerRecipeSkill`); a mount failure after open closes the session before the error escapes. Session teardown is registered before the gateway effect so disposers run in the safe order (tools unregister, then children release). Every app-reported path goes through `confineArtifact`; an escape fails the call. The [Craft bridge pilot Agent Note](../../../.agents/notes/implemented/feature/2026-10-24-v0.3.4-craft-bridge-pilot.md) records the lazy-gateway decision and its alternatives.

| File | Role |
|---|---|
| [`src/plugin.ts`](src/plugin.ts) | Gateway registration, active-app lifecycle, model-facing renderers |
| [`src/bridge.ts`](src/bridge.ts) | Per-app tool bridge and recipe-skill registration |
| [`src/artifacts.ts`](src/artifacts.ts) | Artifact confinement and result projection |
| [`src/types.ts`](src/types.ts) | Gateway vocabulary (`CraftOpenMode`, `CraftOpenSummary`, …) |

</details>

**Runtime invariant:** No companion is published. The gateway keeps no state beyond per-app tool-and-skill bridges mounted through `ctx.craft`, and artifact paths are confined before any result reaches the model, so each mount is already its own guarded unit.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Craft group map](../README.md) - the complete package family.
- [Craft service](../craft/README.md) - manifests, health states, and session lifecycle.
- [MCP client](../../mcp/mcp-client/README.md) - the tool bridge and name contract.
- [Generated tool catalog](../../../docs/tool-catalog.md) - the exhaustive schema source.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

Two gateway tools. `craft_list_apps` takes no arguments and returns one line per pilot app with its measured installation state. `craft_open_app` takes `app` (id or alias) and an optional `mode` of `headless`, `attach`, or `close`. The generated [tool catalog](../../../docs/tool-catalog.md#greeneekgnk-tool-craft) is the exhaustive schema source.

#### Token effect

Two fixed schemas while no app is active; opening an app adds only its manifest-curated meta-tools, and closing removes them again.

#### KV Cache effect

Prefix-stable while no app opens; mount and dispose of bridge tools change the visible tool list from that request onward.

### Tool-call history and result

#### What the model sees

A successful open returns `<App> (<id>) is running. Artifacts belong under <root>. Mounted tools: …`. Bridge tools return the app's text content followed by the confined artifact list. `craft_list_apps` renders one `Display name (id): state` line per app.

#### Token effect

Gateway results are small and fixed-shape; bridged app results scale with whatever the app returns.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Attach mode refuses in the pilot** - `craft_open_app` with `mode: 'attach'` throws even for an attach-enabled manifest until the upstream authenticated control channel ships.
- **Pilot roster only** - only the apps present in `@greeneek/gnk-craft`'s bundled manifests (PhotoCraft, PdfCraft) are addressable.
- **Workspace roots from the calling agent** - the job roots derive from the agent session's `cwd`; a tool call outside an agent session falls back to the process directory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>

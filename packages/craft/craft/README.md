---
description: "The Craft capability seam (ctx.craft): manifest catalog, four-state health, headless session lifecycle, root confinement, and the attach gate."
kind: "package-reference"
---

# @greeneek/gnk-craft

## Summary

`gnk-craft` defines the Craft capability seam (`ctx.craft`) for the Greeneek Harness: it validates application manifests, manages the four-state lifecycle of ArtCraft creative applications (`not-installed`, `app-installed-cli-missing`, `ready`, `running`), enforces workspace root confinement, and maintains the per-launch control token required for headless automation. It provides no OS discovery or subprocess execution of its own — a provider such as `@greeneek/gnk-craft-local` registers to own the host platform. Choose it when composing the Craft capability seam into an agent profile.

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

Mount this package along with a host provider (`@greeneek/gnk-craft-local`) and the tool package (`@greeneek/gnk-tool-craft`) to enable Craft application workflows.

### Minimal composition

```yaml
- name: '@greeneek/gnk-craft'
- name: '@greeneek/gnk-craft-local'
- name: '@greeneek/gnk-tool-craft'
```

### The four application states

| State | Meaning |
|---|---|
| `not-installed` | The application was not found in the launcher manifest or Windows registry |
| `app-installed-cli-missing` | The application GUI is present, but its command-line interface executable is missing |
| `ready` | Both application and CLI are verified with absolute paths and ready for headless sessions |
| `running` | An active headless automation session is currently open |

### Concurrency and root confinement

The service bounds concurrent active headless applications (default: 2, configurable via `maxActiveApps`). Every open session receives isolated job directories under the workspace root (`craft/io` and `craft/out`), and writes a one-time control token file verified by the headless process.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service mounts onto the root context as `ctx.craft`. Providers register via `ctx.craft.registerProvider(provider)` returning an unregister disposer. Calling `ctx.craft.open({ app, workspaceRoot })` validates the manifest, asserts the `ready` state, enforces the active session limit, writes the control token, and delegates to the provider's `open()` contract. Disposing the context or calling `closeAll()` cleanly terminates all child sessions.

| File | Role |
|---|---|
| [`src/service.ts`](src/service.ts) | `CraftRuntime` service definition and session lifecycle |
| [`src/manifest.ts`](src/manifest.ts) | Manifest loading and JSON schema validation |
| [`src/paths.ts`](src/paths.ts) | Root confinement, token path, and artifact path resolution |
| [`src/types.ts`](src/types.ts) | Typed service, manifest, and provider contracts |
| [`src/error.ts`](src/error.ts) | Typed `CraftError` codes |

</details>

**Runtime invariant:** No companion is published. Manifest validation, the four-state lifecycle, and root confinement are enforced at `CraftRuntime` admission itself, so a guard face would only restate checks the service already owns.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Craft group map](../README.md) — the complete package family.
- [Local Craft provider](../craft-local/README.md) — launcher and registry discovery.
- [Craft tools](../tool-craft/README.md) — model-facing gateway and artifact tools.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@greeneek/gnk-tool-craft`, which registers the gateway tools and recipe skills built on this service's catalog, status, and sessions.

#### KV Cache effect

None of its own; only the tool consumer's mount and dispose of bridge tools change the model-visible tool list.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Live GUI attach gated** — Live attach mode is disabled by default in pilot manifests until upstream authenticated control channel protocols are hardened.
- **Pilot applications** — Bundles manifests for PhotoCraft and PdfCraft; remaining ArtCraft suite applications are added in follow-on milestones.
- **Unverified manifest facts** — PdfCraft's manifest is entirely unproven, and PhotoCraft's `launch.connected`, `headless.listMethod`, `headless.toolFilter`, `headless.artifactTools`, `riskyCommandClasses`, and attach facts remain unproven against an installed app. `verified: false` is provenance documentation only: the loader validates the flag's type and no runtime decision reads it.
- **PhotoCraft headless entry and catalog** — `launch.headless` is `{cli} serve --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}`, proven against `photocraft-cli.exe` 0.15.1 (build 60c87b988): one `{"id":1,"method":"methods","params":{}}` line answered `{"id":1,"ok":true,"result":[18 methods]}`, `engine.commands` answered with its command registry, and closing stdin exited 0 with no surviving process. The same build refuses `photocraft-cli --headless` with exit 2, and `serve` knows no `command_list` method, so the first catalog call cannot list tools yet (mechanism: [local provider](../craft-local/README.md)).
- **Unversioned discovery records bypass the version floor** — `minVersion` is 0.15.1, the ProductVersion whose `serve` entry was proven, but discovery compares only a version the installation source reported; the Windows registry `InstallDir` value carries none, so that path accepts any build.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** Service registration is a single root effect. Session teardown ensures all provider child processes are terminated on unmount.

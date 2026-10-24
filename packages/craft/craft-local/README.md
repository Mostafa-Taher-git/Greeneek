---
description: "Local host provider for the Craft bridge: launcher manifest and registry discovery, absolute CLI resolution, and token-gated headless sessions."
kind: "package-reference"
---

# @greeneek/gnk-craft-local

## Summary

`gnk-craft-local` provides the local host adapter for `@greeneek/gnk-craft`: it inspects local ArtCraft Launcher installation manifests across platforms (Windows `%LOCALAPPDATA%`, macOS `Application Support`, Linux `~/.local/share`), scans the Windows registry (`HKLM\Software\<App>\InstallDir`) for MSI installations, verifies CLI executable stems with absolute paths, and spawns headless MCP sessions over `ctx.subprocess`. Spawns require a per-launch control token file written under the confined job directory. This package provides no model-facing tools of its own.

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

Compose this package alongside `@greeneek/gnk-craft` and `@greeneek/gnk-subprocess-local` in a host profile:

```yaml
- name: '@greeneek/gnk-subprocess-local'
- name: '@greeneek/gnk-craft'
- name: '@greeneek/gnk-craft-local'
```

### Discovery locations

| Platform | Primary Discovery Path | Fallback Path |
|---|---|---|
| Windows | `%LOCALAPPDATA%\ArtCraft Launcher\installed.json` | Registry `HKLM\Software\<App>\InstallDir` |
| macOS | `~/Library/Application Support/ArtCraft Launcher/installed.json` | — |
| Linux | `~/.local/share/artcraft-launcher/installed.json` | — |

The provider strictly rejects bare executables on the ambient system `PATH`: only verified absolute paths inside recognized installation roots are accepted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider implements `CraftHostProvider` and registers on `ctx.craft`. During `discover(app)`, it checks launcher JSON manifests and Windows registry entries, mapping historical application aliases (`printcraft` -> `pdfcraft`). During `open(request)`, it verifies the control token, creates the confined job root, and launches the headless CLI with piped stdio. The returned session wraps a `JsonRpcCraftTransport` that speaks JSON-RPC 2.0 to the headless application process.

| File | Role |
|---|---|
| [`src/provider.ts`](src/provider.ts) | `CraftLocalProvider` implementation |
| [`src/discovery.ts`](src/discovery.ts) | Cross-platform manifest and registry discovery |
| [`src/transport.ts`](src/transport.ts) | JSON-RPC 2.0 frame transport over piped stdio |
| [`src/platform.ts`](src/platform.ts) | Platform executable naming and path resolution |
| [`src/node-io.ts`](src/node-io.ts) | Node.js filesystem and subprocess adapter |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Craft group map](../README.md) — package family overview.
- [Craft service definition](../craft/README.md) — session lifecycle and manifest catalog.
- [Subprocess capability](../../subprocess/subprocess/README.md) — process tree execution.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@greeneek/gnk-tool-craft`, which registers the bridged tools whose calls this provider executes.

#### KV Cache effect

None of its own; the provider plane is host-only and the tool consumer owns the model-visible registrations.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Connected GUI mode** — Desktop GUI launching with `--control` loopback is marked desktop-only; live attach is gated.
- **Auto-installation** — Does not invoke external installers automatically; missing applications must be installed by the user via ArtCraft Launcher.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** All child process trees spawned by this provider are bound to the owning session lifecycle and terminated cleanly during unmount.

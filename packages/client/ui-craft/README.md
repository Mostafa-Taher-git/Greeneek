---
description: "The Craft pilot's browser surfaces: the Settings section with per-app installation state, check, open, and download actions, and the artifact tool card for Craft bridge calls; for users of the desktop bridge and its maintainers."
kind: "package-reference"
---

# @greeneek/gnk-client-ui-craft

## Summary

This package provides the browser halves of the Craft bridge pilot: a Settings section listing each pilot app with its measured installation state and the action that fits that state, and a keyed artifact card that surfaces the files a Craft bridge tool call produced. The browser cannot read the Host's `ctx.craft`, so the section reads through an injected `CraftSettingsSource`. The shipped web composition injects none, and the static pilot catalog then reports every row `unavailable` with a pointer to the desktop app — the surface is honest about the missing bridge instead of guessing an installation state. A desktop build passes a wire-backed source through the plugin's options argument.

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

Mount it beside the settings and tool surfaces; `inject` names the locale, renderer, settings, and tool packages it needs. The section takes the `settings.section` seat `craft-suite` (order 40). The artifact card takes the keyed `tool.call.toolview` seats for exactly the bridge tools whose results carry artifact paths (`mcp__<app>__render_preview`, `mcp__<app>__screenshot`); a wildcard seat would claim bridge tools that have no artifact section. All copy lives in the `craft` locale namespace with complete en and zh dictionaries.

### The Settings section

Each row is a state dot, the app name, and a localized state badge; a host-provided detail line rides under non-ready states. Actions follow the state: "Check installation" re-runs discovery on every row, `ready` adds "Open connected", `running` offers the launcher deep link, and `not-installed` or `app-installed-cli-missing` offer the vendor download page. A failed roster read shows an alert and a retry; an empty catalog, a failed row action, and a missing bridge each render an explicit status line instead of an empty list.

### The artifact card

The card is collapsed by default: a state dot, the artifact title, the file count, and one chip per artifact path — clicking a chip opens the file through the transcript's `openFile`, and the full confined path rides the tooltip. The app's first text line shows below the header, so a failed call stays readable without opening the trajectory. The model reads only the durable call result — the trailing `Artifacts:` section the Host's renderer appends — so a replayed recorded session renders the same card with no live filesystem access.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

`PILOT_APPS` mirrors the two Host manifests because the browser cannot import the Host's manifest loader, and a test compares the mirror against `packages/craft/craft/manifests/*.json` so the two cannot drift silently. `fallbackSource()` answers every read with the static rows; its `check` and `launchConnected` return the same `unavailable` row, so a section that somehow enabled the actions still could not fabricate a state transition — only a wire-backed source can report an installation state. The card parses exactly the text the Host's `renderCallText` produces and flattens result blocks under the same Tool-row text contract as ui-tool's `resultText`. The host half (`src/index.ts`) exports an empty `apply()` so the package composes on the Host without behavior of its own.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host-half entry: empty `apply()` |
| [`src/client/index.ts`](src/client/index.ts) | Plugin registration: dictionaries, settings seat, keyed toolview seats |
| [`src/client/contract.ts`](src/client/contract.ts) | State vocabulary and the `CraftSettingsSource` seam |
| [`src/client/catalog.ts`](src/client/catalog.ts) | Static pilot mirror, artifact tool keys, fallback source |
| [`src/client/settings/CraftSection.tsx`](src/client/settings/CraftSection.tsx) | The Settings section component |
| [`src/client/artifact/model.ts`](src/client/artifact/model.ts) | Replay-stable card model from the durable result slice |
| [`src/client/artifact/CraftArtifactRow.tsx`](src/client/artifact/CraftArtifactRow.tsx) | The artifact card component |
| [`src/client/locales.ts`](src/client/locales.ts) | `craft` namespace en/zh dictionaries |

</details>

**Runtime invariant:** No companion is published. The browser face owns no host state: the section renders what an injected `CraftSettingsSource` reports and the artifact card mirrors tool-call results, so a guard face would have nothing local to cross-check.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Craft group map](../../craft/README.md) — the complete package family.
- [tool-craft](../../craft/tool-craft/README.md) — the bridge that produces the results the artifact card renders.
- [ui-settings](../ui-settings/README.md) — the settings shell that declares the section seat.
- [ui-tool](../ui-tool/README.md) — the toolview seat and the shared result-text contract.
- [Craft bridge pilot Agent Note](../../../.agents/notes/implemented/feature/2026-10-24-v0.3.4-craft-bridge-pilot.md) — the pilot's decisions, including the honest-absence fallback.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders durable bridge results and host-reported installation state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Placeholder vendor links** — the launcher and download URLs are `craft.example` placeholders until the real-app Windows E2E verifies them, matching the manifests' `verified: false` provenance.
- **No wire-backed source ships** — the desktop composition that injects a Host-connected `CraftSettingsSource` lands with the desktop bridge wave; until then every web deployment shows the static `unavailable` rows.
- **Two pilot apps only** — the roster mirrors exactly the bundled pilot manifests; a third app needs both its manifest and its `PILOT_APPS` entry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>

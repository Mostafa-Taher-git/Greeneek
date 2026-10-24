---
description: "The craft package group: ArtCraft suite discovery, manifests, headless session lifecycle, and model tools."
kind: "package-group"
---

# craft/ — ArtCraft suite integration

## Summary

The `craft/` group connects Greeneek to the ArtCraft creative and document application suite (PhotoCraft, PdfCraft, FigCraft, and siblings). The integration is headless-first and security-gated: Greeneek discovers installed applications through launcher manifests or Windows registry keys, validates executable paths, confines working directories to workspace job folders, and drives headless MCP sessions through standard CLI interfaces. The capability is split across three packages: the core service seam (`@greeneek/gnk-craft`), the host OS discovery and subprocess provider (`@greeneek/gnk-craft-local`), and the model-facing gateway and artifact tools (`@greeneek/gnk-tool-craft`).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`craft/`](craft/README.md) | Defines the Craft application catalog, manifests, four-state health, and headless session lifecycle | `ctx.craft` |
| [`craft-local/`](craft-local/README.md) | Local host provider: OS launcher and Windows MSI registry discovery, CLI path verification, and token-gated headless spawns | registers on `ctx.craft` |
| [`tool-craft/`](tool-craft/README.md) | Gateway model tools (`craft_list_apps`, `craft_open_app`), app meta-tool bridging, and artifact path collection | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Craft subsystem reference](../../docs/subsystems/craft.md) — the `ctx.craft` service API and the manifest/session vocabulary types.
- [Craft bridge pilot Agent Note](../../.agents/notes/implemented/feature/2026-10-24-v0.3.4-craft-bridge-pilot.md) — architecture, security posture, and the headless pilot decisions.
- [Client Craft UI](../../packages/client/ui-craft/README.md) — settings section, app status rows, and artifact viewer cards.
- [MCP client](../mcp/mcp-client/README.md) — the scoped tool bridge used by active headless Craft sessions.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

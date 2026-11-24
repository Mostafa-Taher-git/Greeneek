---
description: "The browser package group: navigation seam, runtime providers, AI provider sessions, and model-facing browser tools."
kind: "package-group"
---

# browser/ — Browser surface and content tools

## Summary

The `browser/` group connects the right-panel browser surface and Agent tools through one tracked navigation authority. `browser-use` defines the seam with one replaceable backend and per-profile state; `browser-surface` records navigation without a runtime, and `browser-playwright` supplies bounded real-page reads. `browser-ai` registers AI vendors with isolated profiles, `command-browser-ai` opens them from a human command, and `tool-browser` registers the model-facing browser schemas and guidance.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`browser-use/`](browser-use/README.md) | Service Definition: one backend slot, per-profile tracked state, and the `browser/surface` event | `ctx.browser` |
| [`browser-surface/`](browser-surface/README.md) | Default no-runtime backend that records navigation for the visible webview | registers on `ctx.browser` |
| [`browser-playwright/`](browser-playwright/README.md) | Content-capable backend with persistent profiles and bounded page reads | registers on `ctx.browser` |
| [`browser-ai/`](browser-ai/README.md) | AI vendor registry with isolated profiles and credential-free session status | `ctx.browserAI` |
| [`command-browser-ai/`](command-browser-ai/README.md) | `/browser-ai` command for manual sign-in to a provider site | registers on `ctx.commands` |
| [`tool-browser/`](tool-browser/README.md) | Six browser tool schemas and the pinned guidance prompt | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Browser subsystem reference](../../docs/subsystems/browser.md) — the `ctx.browser` service API and the navigation/state types.
- [Browser AI subsystem reference](../../docs/subsystems/browser-ai.md) — the `ctx.browserAI` registry and session vocabulary.
- [Tool catalog](../../docs/tool-catalog.md#greeneekgnk-tool-browser) — the generated schemas for the six browser tools.
- [Right-panel T3 parity note](../../.agents/notes/proposed/feature/2026-11-17-right-panel-t3-parity.md) — the decision record behind the browser surface work.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

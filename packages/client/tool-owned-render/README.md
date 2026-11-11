---
description: "Tool-owned render registrants for read, bash, write/edit, grep/glob, web_search/web_fetch, and read_image."
kind: "package-reference"
---

# @greeneek/gnk-client-tool-owned-render

## Summary

`gnk-client-tool-owned-render` is the ported tool-owned render package: nine keyed `tool.call.toolview` registrants (`read`, `read_image`, `bash`, `write`, `edit`, `grep`, `glob`, `web_search`, `web_fetch`) that derive cards from current `ToolCallBlock` fields (`block.name` and `block.argsRaw` while running, `block.call`, `block.content`, and `block.meta` once settled). `read_image` composes the same row primitives as `read`.

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

Load the plugin and it registers its nine rows into `tool.call.toolview`. Each row shows the localized title, the args-derived summary, and the flattened result text when settled. Unknown or malformed args fall back to the raw first line; an empty result falls back to the structured error line.

```text
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: 'conversation' }, ReadRow))
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<a id="implementation-internals"></a>
<details>
<summary>Implementation internals — click to expand</summary>

The port keeps one pure model (`deriveModel`) and one shared row (`OwnedRow`). `deriveModel` parses `argsRaw` as JSON, picks the per-tool summary key (`path`/`file_path`, `command`, `pattern`/`query`, `url`), and flattens `content` text blocks plus `meta` is not rendered. `read_image` delegates to `OwnedRow` exactly as `read` does, satisfying the same-primitive requirement. The `ctx.slots` augmentation resolves through `@greeneek/gnk-client-ui-renderer/client`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-tool](../ui-tool/README.md) — the owning package for `tool.call.toolview` and the generic fallback.
- [ui-conversation](../ui-conversation/README.md) — owns the `conversation` locale namespace and tool titles.
- [Conversation subsystem](../../../docs/subsystems/conversation.md) — how business features register views.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package only renders logged calls without changing model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Title and summary only** — the port does not reproduce the prototype's full cards; structured search, diff, and terminal bodies remain in `ui-tool`.
- **Not mounted by the shipped bundle** — the package is a portable registrant set; the web bundle mounts `ui-tool`'s built-ins, so loading both replaces those keys rather than adding a parallel tree.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Rendering is browser-only; slot ownership is checked by ui-slots.

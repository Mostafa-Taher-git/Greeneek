---
description: "Plugins settings section with built-in plugin settings, experimental plugins and an add-plugin dialog"
kind: "package-reference"
---

# @greeneek/gnk-client-ui-settings-plugin-manager

## Summary

`gnk-client-ui-settings-plugin-manager` contributes the Plugins settings section, distinct from the renamed Built-in plugins section. It renders built-in plugin settings with a jump to the built-in list, experimental plugins, a refresh control, an Add plugin split button with an install dialog, a registry selector with official npm registry / Mainland China mirror / custom address, and a trust warning. Inventory data comes from the read-only Host `pluginInventory` Remote, filtered to user plugins; the Add plugin menu can seed a plugin-creation session. Product copy is localized in zh/en/ar.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

### Plugins settings section

#### What the model sees

Nothing from this package enters a model request. The section presents Host-owned plugin inventory through `ctx.remote.pluginInventory.list()` and collects user input for a future install Remote.

#### Token effect

Zero direct tokens. The package contributes no system-prompt text, tool schema, or message content.

#### KV Cache effect

None; the package neither assembles nor sends a provider request, so it cannot invalidate a reusable cached prefix.

## Known Limitations and Deferred Work

- **Read-only inventory** — installation and permanent experimental-plugin enablement need a Host management Remote; the dialog and toggles report that boundary instead of mutating state.
- **No registry reachability check** — the custom-address field validates URL form only; this build does not contact the selected registry.

### Dev Note

No invariant companion is published. The package owns a standalone main-column page and a sidebar shortcut.

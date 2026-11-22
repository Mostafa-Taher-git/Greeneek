# @greeneek/gnk-client-ui-settings-plugin-manager

Plugins settings section: built-in plugin settings, experimental plugins, a refresh control, an Add plugin split button with an install dialog, a registry selector (official npm registry / Mainland China mirror / custom address), and a trust warning. Inventory data comes from the read-only Host `pluginInventory` Remote; product copy is localized in zh/en/ar.

## Model Experience

This package adds no model-visible text and no tokens. It presents Host-owned plugin state only.

## Known Limitations and Deferred Work

Plugin installation and permanent experimental-plugin enablement need a Host management Remote; the dialog and toggles are read-only in this build.

# Agent Note: Desktop bridge registers before the first window loads

Status: implemented

## Problem

The desktop main process registered `registerDesktopBridge` only after the gnk service booted, but `createWindow()` runs earlier and the startup page's `did-finish-load` immediately injects the frameless titlebar script, which calls `api.windowIsMaximized()`. The race surfaced consistently at dev boot (`No handler registered for 'window-is-maximized'`) and left every splash-page window control dead until the service came up, because the splash page had a bridge only if the registration landed before its load event.

## Decision

`apps/desktop/src/main.js` registers the desktop bridge before `createWindow()` and keeps the handler set stable from the first loaded page. The functions the service boot later swaps or populates — the update manager among them — are supplied as late-binding accessors (`getUpdateManager: () => updateManager`), so the pre-boot bridge returns each handler's current value at call time instead of a value frozen before `createUpdateManager` ever ran. A late-registration unit test in `apps/desktop/test/desktop-bridge.test.js` covers an update manager attached after registration.

## Alternatives considered

**Re-register the bridge after boot.** Rejected: re-registering IPC handlers duplicates channels, leaves the window with two competing states per channel, and still misses the first load event; a stable early registration with late-bound values has no window that sees a temporary handler set.

**Delay injection of the frameless titlebar until `ready-to-show`.** Rejected: it moves but does not remove the race (a ready window can still resolve the titlebar script before a slow service boot), and it changes the visible startup sequence for every page, not only the bridgeless one.

## Consequences

No window can load before its IPC contract exists, so the first page's titlebar maximization probe and the splash controls work from boot on, and the dev-mode `No handler registered` error is gone from the app log. Any handler state that must exist before the app boot can still only read what the late-bound accessors expose; handlers created before registration and populated later change behavior again only for the phases they own.

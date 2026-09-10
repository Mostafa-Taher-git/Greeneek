# Agent Note: Sandboxed ESM preload killed the desktop bridge

Status: implemented

## Problem

Three desktop reports traced to one root cause: the top-right window
buttons rendered but never acted, and Settings → About showed its
browser branch (served version plus a downloads link) with no
Check-for-updates button. The update buttons, the IPC handlers, and the
preload surface all existed — but `window.greeneekDesktop` was undefined
in the shipped app, so the injected titlebar closed over a null bridge
and the About section fell back to its no-bridge branch.

## Decision

The preload is now plain CommonJS (`apps/desktop/src/preload.cjs`).
Electron runs sandboxed preloads without an ESM context, so the
previous `import`-based `preload.js` failed silently under the
`sandbox: true` window options; a CJS `require('electron')` preload is
the form that works in every Electron version, sandboxed or not. The
old file is deleted and `main.js` points at the new one.

The injected titlebar script now resolves the bridge at click time
instead of inject time and warns once when it is absent, so a future
bridge failure is diagnosable from the console instead of silent. The
frameless strip is a pure overlay again (no body padding): the hosted
client keeps the sidebar background flush to the window top and offsets
its own content below the 40px strip via `data-desktop-host`, which is
absent in browsers and tests, so snapshots never see it.

Settings → About keeps the gear fallback for unknown sections but uses
a Lucide info glyph for `about`, and text selection rides the product
green (`--dsw-alias-text-selection` in both themes) instead of the
browser-default blue.

## Alternatives considered

**Keep ESM and disable the sandbox.** Rejected: the sandbox is a
deliberate security boundary (security.js); dropping it for module
syntax trades real protection for style.

**Pad the body from the shell as before and accept the sidebar gap.**
Rejected: the gap is the reported defect. The client owns its layout,
so it owns the strip offset; the 40px mirror is commented at each site
and both ship in the same release.

**Resolve picking ambiguity for every unresolvable peer in staging.**
Out of scope: peers are optional by contract and already skip with a
warning; only hard dependencies fail the build.

## Consequences

Window controls work in the packaged app, and About shows versions with
Check-for-updates plus Restart-and-install once an update is downloaded.
`apps/desktop/test/preload-bridge.test.js` loads the shipped preload
with only the sandboxed electron subset stubbed and asserts the exact
channel surface plus the absence of ESM syntax, so a return to ESM
imports fails the suite. The icon census moves 79 to 80.

## Follow-up: getter export killed bridge registration (2026-09-10)

The CJS preload restored the bridge object, but the buttons stayed dead
in the packaged app. CDP interrogation of the live window plus the
main-process log gave the real sequence: `TypeError: Cannot set
properties of undefined (setting 'autoDownload')` inside
`createUpdateManager`, so `launch()` rejected before
`registerDesktopBridge` ran — no IPC handlers existed at all
(`No handler registered` for every channel, versions included).

`electron-updater` defines `autoUpdater` through
`Object.defineProperty(exports, "autoUpdater", { get ... })`, which ESM
named-import detection cannot see. `(await
import('electron-updater')).autoUpdater` is therefore undefined in the
packaged loader (plain-Node interop resolves the getter, which is why no
local run or CI lane ever reproduced it). `main.js` now unwraps through
`resolveAutoUpdater` (named export, else default-exports object — the
default interop works under every loader), and updater creation is
non-fatal: on failure the bridge still registers with its update
channels degraded to `unsupported`, a state the About UI already
renders. A loader-shape regression test covers the module forms.

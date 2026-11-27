# Agent Note: Product-wide audit fixes

Status: implemented

## Problem

An independent product-wide audit found genuine defects not in the Failure Inventory:

- Deep-agent `decide()` accepted any Trigger sharing a thread with an Eval, including Triggers the policy had filtered out, so a filtered event could create a Ticket.
- Saved Deep-agent evaluation timeout, pause, and worker capacity were written to the settings document but not applied to the live policy or executor; the panel could report "saved" while behavior stayed unchanged.
- Deep-agent prompt-history failures looked like an empty history and reset failures could become unhandled rejections.
- The overview reported "no sources configured" when a Discord or GitHub adapter was active but the policy source map was empty.
- Automation unload stopped the scheduler but left active runs using their Agent after host teardown.
- Automation task actions discarded failed Remote results, so a persisted failure stayed invisible until a later refresh.
- A rejected manual Desktop update check could leave the user without any feedback when the updater emitted no `error` event.
- A Desktop renderer crash only wrote a log line, leaving a blank window with no recovery path.
- Right-panel surfaces were rebuilt from memory on every reload, even though the surrounding panel geometry persisted.

## Decision

`decide()` admits only the Eval's primary Trigger and raises `notPrimary` for the rest. `policySettings()` includes the persisted evaluation timeout; `saveSettings` and boot apply persisted worker capacity through `WorkerSlots.setCapacity`; the eval block persists `paused` when the panel sends it. Prompt-history and reset failures set an explicit localized status. The overview counts boot-configured adapters as sources.

Automation unload aborts active controllers, disposes their handles, and clears the run map. Automation actions refresh in both success and failure paths and show a localized failure notice.

The Desktop updater routes both the `error` event and a rejected `checkForUpdates()` through one reporter that shows a single manual-check failure dialog. Renderer crashes follow a bounded, versionable policy: two automatic reloads in a minute, then a Retry/Quit dialog. The policy lives in a pure module so it can be tested without Electron.

The right-panel surface store uses versioned per-session persistence, so the open surfaces and active tab survive a reload alongside the persisted panel width.

## Alternatives considered

Adding Ticket or Trigger CRUD would contradict the append-only record design. Removing the capacity and timeout controls would drop real runtime capabilities rather than fixing the wiring. Silently disabling persisted surfaces would keep tests simple but leave reload behavior inconsistent with the rest of the layout.

## Testing

- Deep-agent and automation suites: 9 files / 63 tests passed.
- Desktop suite: 125 tests passed, including new regressions for the rejected manual update check and the crash policy.
- GUI tier: 324 files / 4473 passed, 1 skipped, including a new right-panel persistence regression and updated isolation in the surface panel spec.
- Live Web verification: opened Files, reloaded, and confirmed the surface restored with zero page errors.
- `pnpm run typecheck` and `pnpm run lint` pass.

## Consequences

The audited workflows now match their displayed state: rejected events cannot create Tickets, saved limits govern the runtime, unload owns its runs, failures are visible to the user, and Desktop recovery is actionable. Panel state now persists consistently across reload.

# Agent Note: Product-wide audit fixes

Status: implemented

## Problem

Two independent product-wide audits found genuine defects beyond the Failure Inventory:

- Deep-agent `decide()` accepted any Trigger sharing a thread with an Eval, including Triggers the policy had filtered out, so a filtered event could create a Ticket.
- Saved Deep-agent evaluation timeout, pause, and worker capacity were written to the settings document but not applied to the live policy or executor; the panel could report "saved" while behavior stayed unchanged.
- Deep-agent prompt-history failures looked like an empty history and reset failures could become unhandled rejections.
- The overview reported "no sources configured" when a Discord or GitHub adapter was active but the policy source map was empty.
- Automation unload stopped the scheduler but left active runs using their Agent after host teardown.
- Automation task actions discarded failed Remote results, so a persisted failure stayed invisible until a later refresh.
- Appearance, font-size, and busy-Enter controls updated their live value before a settings write settled; a rejected write had no user-visible failure and could look saved.
- A rejected manual Desktop update check could leave the user without any feedback when the updater emitted no `error` event.
- A Desktop renderer crash only wrote a log line, leaving a blank window with no recovery path.
- Right-panel surfaces were rebuilt from memory on every reload, even though the surrounding panel geometry persisted.
- Scheduled automation runs completed without refreshing the open task panel, so results appeared only after a manual reload.
- The Inspector integration test used a 5 s CDP-call and delivery budget and timed out under a four-worker full suite while passing in isolation.

## Decision

`decide()` admits only the Eval's primary Trigger and raises `notPrimary` for the rest. `policySettings()` includes the persisted evaluation timeout; `saveSettings` and boot apply persisted worker capacity through `WorkerSlots.setCapacity`; the eval block persists `paused` when the panel sends it. Prompt-history and reset failures set an explicit localized status. The overview counts boot-configured adapters as sources.

Automation unload aborts active controllers, disposes their handles, and clears the run map. Automation actions refresh in both success and failure paths, and the panel polls the durable catalog so scheduler-owned results appear without a gesture.

`SettingsScope` mutation methods now resolve to a boolean that says whether the Host persisted the write. Theme and submission-policy setters return that result, revert to the Host value on rejection, and the three affected rows show a localized failure notice. The Web plugin dialog now names the supported `gnk plugin add/remove` CLI workflow instead of a generic unavailability notice.

The Desktop updater routes both the `error` event and a rejected `checkForUpdates()` through one reporter that shows a single manual-check failure dialog. Renderer crashes follow a bounded, versionable policy: two automatic reloads in a minute, then a Retry/Quit dialog. The right-panel surface store uses versioned per-session persistence.

Inspector test transport budgets were raised to 15 s and the case/teardown budgets to 45 s; the runtime behavior is unchanged.

## Alternatives considered

Adding Ticket or Trigger CRUD would contradict the append-only record design. Removing the capacity and timeout controls would drop real runtime capabilities rather than fixing the wiring. A Host-side Web install Remote would add package-manager execution and profile mutation to the Web Host; the documented v0.8.8 decision keeps that work in `gnk plugin`, so the dialog now states the supported path. Raising Inspector runtime timeouts would change product behavior for a test-only transport problem.

## Testing

- Deep-agent and automation suites: 9 files / 63 tests passed.
- Desktop suite: 125 tests passed, including regressions for the rejected manual update check and the crash policy.
- GUI tier: 324 files / 4473 passed, 1 skipped.
- Settings-write suite: 49 files / 614 tests passed, including successful and rejected writes, value reversion, and localized row alerts.
- Discord source and runtime keyless suites: 4 files / 23 tests passed.
- Inspector integration spec: 10/10 passed in isolation and under four workers; full 4-worker suite re-run after the budget change.
- Live Web: all six modes produced real model turns; scheduled task fired at its configured wall clock with `succeeded` and result `SCHEDULED OK`; GitHub PR list, detail, and Linked PR panels returned real repository data; right-panel surface restored after reload.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run doc-sync`, `pnpm run hygiene` pass.

## Consequences

The audited workflows now match their displayed state: rejected events cannot create Tickets, saved limits govern the runtime, rejected settings writes revert and are reported, unload owns its runs, scheduled results surface live, failures are visible to the user, and Desktop recovery is actionable. Plugin management is explicitly CLI-owned, and Inspector transport waits tolerate CI contention without changing product behavior.

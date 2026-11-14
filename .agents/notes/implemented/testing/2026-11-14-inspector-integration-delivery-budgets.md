# Agent Note: inspector integration delivery budgets and quiescent teardown

Status: implemented

## Problem

`packages/experimental/inspector/tests/integration.host.spec.ts` drives a real Worker across realms over a CDP WebSocket, so every assertion about delivered state waits on transport. The file already raised `testTimeout` to 30 s for that reason, but its twelve `vi.waitFor` polls still used the 1 s default and its `afterEach` still used the 10 s default hook budget.

CI run [43594956657](https://github.com/Mostafa-Taher-git/Greeneek/actions/runs/43594956657) failed the EventSource abort case on `e18db56c`. Two annotations describe one cause: the `Network.loadingFinished` poll timed out, then `afterEach` timed out as well. The hook failure is a cascade, not a second defect. `abort.abort()` runs only after the first poll, so a failure before it leaves the SSE response socket open, and `server.close()` waits for that socket until the hook budget expires.

## Decision

The file declares one budget for transport and one for disposal:

- `vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })` — the hook disposes the same Worker and sockets the cases drive, so it shares the contention budget the tests already had.
- `DELIVERY_TIMEOUT_MS = 5_000` behind a `waitForDelivery` helper — every poll waits for one Worker round trip, which is transport latency rather than the behavior under test.
- `afterEach` calls `server.closeAllConnections()` before awaiting `close()`, so a failed case releases its response socket instead of replacing the original failure with a hook timeout.

No assertion changed. A state that never arrives still fails its poll, now after a bounded 5 s.

## Verification

- The file passes 10/10 locally before and after the change.
- Negative control, injected failure before `abort.abort()`: with `closeAllConnections()` and the 30 s hook budget the case reports the injected error and the file finishes in 3.6 s; with the pre-change teardown the same injection produces `Hook timed out in 10000ms` beside the original error, matching both CI annotations.

## Alternatives considered

**Only raise the poll timeout.** The 1 s budget explains the first annotation, but the following hook timeout would still replace the next early failure with a 10 s teardown error, so the reported cause stays ambiguous.

**Only fix teardown.** Correct teardown still reports a delivered-state poll that timed out at 1 s on a loaded runner, which is the failure this change exists to remove.

**Retry the failed case.** A retry hides which budget was too small and leaves the teardown hang in place for every case that fails before its abort.

## Consequences

Inspector integration failures now name the state that did not arrive rather than a teardown timeout, and an early failure no longer costs 10 s per case. The file keeps its real Worker, real socket, and real CDP round trips; only the budgets and the socket release changed.

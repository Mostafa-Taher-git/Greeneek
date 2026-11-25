# Agent Note: SDK persistent-tools composition

Status: implemented

## Problem

The `sdk/persistent-tools` snapshot profile re-declared `terminal`, `terminal-bash`, and `fs-local` rows already provided by the `sdk-minimal` base patch. Depending on composition order this produced duplicate loader entries, a missing `fs` service, or a late SDK handshake on a disposed fiber. The SDK replay also compared stale tool/system-prompt fixtures and a stale tool roster.

## Decision

The scenario keeps only the rows it uniquely owns (`bash-local`, `persistent-bash`) and relies on the base profile for terminal and filesystem services. Its system-prompt and tool-schema sidecars were regenerated on the Linux runner, the expected tool roster was updated to the composed set, and the SDK harness now allows 60 seconds for `initialize` so a loaded CI runner does not time out before boot completes.

## Alternatives considered

Keeping the duplicate rows and disabling the base ones produced either duplicate PTY backend names or an inactive server context; neither was stable. Increasing only the generic request timeout left the initialize timeout at 10 seconds.

## Testing

Full Linux snapshot replay passes 116 tests with no failures; the SDK-only suite passes 16/16.

## Consequences

The fixture now reflects the shipped composition, and a slow runner waits for handshake completion rather than racing a fixed short timeout.

# Agent Note: Windows pwsh status-line padding

Status: implemented

## Problem

On Windows, `tool-pwsh-persistent` timed out on the second command of a real Loader composition. PSReadLine pads the line after `__GNK_PERSISTENT_PWSH_END_<nonce>:0` with spaces before the newline, so `commandOutput` could not parse the exit status, waited until the command deadline, and reset the shell. The same test passes on Linux with pwsh 7.4.6.

## Decision

The status regex accepts horizontal whitespace between the exit code and the newline. The echoed wrapper still cannot fabricate completion: its marker is followed by a quote, not digits. A stub mode with a padded status line guards the behavior.

## Alternatives considered

Increasing the command timeout would only delay the same failure. Stripping all trailing text from the status line would also accept a status followed by arbitrary output, weakening completion detection.

## Testing

`tools.spec.ts` plus `loader-composition.spec.ts`: 2 files, 22 tests passed on Windows. The regression test fails when only the product regex is reverted (`1 failed | 20 skipped`).

## Consequences

Persistent pwsh commands on Windows complete from their real markers instead of timing out and resetting the shell.

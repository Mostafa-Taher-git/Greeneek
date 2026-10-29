# Agent Note: Continuable lanes persist their preset and cwd in descriptor v4

Status: implemented

## Problem

Maestro lanes are continuable children, but only one-shot starts could select an `agentPreset`, and no start carried a lane working directory. A continuable child was rejected with `UNSUPPORTED_CAPABILITY` when a preset was requested because the v3 descriptor recorded only persona and tool filter; a cold resume would have composed the parent's preset instead. The Team spawn surface exposed neither the preset nor a cwd, so lane isolation could not be requested at all.

## Decision

`SUBAGENT_DESCRIPTOR_VERSION` is 4. A continuable descriptor may carry `agentPreset` and the canonical `cwd`; cold resume rejoins the preset through `applyChildComposition` and refuses to resume when the persisted header cwd disagrees with the descriptor. Version 3 remains a supported read-only descriptor with inherited composition and no lane fields; a v3 payload carrying a v4 field is rejected as a corrupt current record, and unknown versions remain unclassified.

`SubagentStartRequest` gains an optional absolute `cwd`, validated at the earliest service boundary before a child exists. `childSessionMeta` takes the lane cwd instead of always copying the parent's. `spawn_teammate` exposes optional `preset` and `cwd` and forwards them into the continuable start; a teammate without either keeps the previous inherited behavior.

## Alternatives considered

- **Keep the continuable refusal and run Maestro lanes on the parent composition.** That makes a lane a prompt, not a preset; the docs lane could not run the instructor tools beside a standard code lane.
- **Store the preset only on the child header.** Headers are read for navigation and may be changed by resume paths; the descriptor is the immutable continuation authority, as it already is for persona and tool filter.
- **Resolve cwd from the parent at every resume.** A lane checkout is the isolation boundary; inheriting the parent cwd after a restart would silently write into the shared checkout.

## Consequences

- A cold resume of a v4 lane rejoins the exact preset and cwd; a missing preset fails the creation rather than falling back.
- A header cwd mismatch is a typed `NOT_RESUMABLE` refusal, not a warning.
- v3 sessions continue to resume with inherited composition; there is no migration and no silent field invention.
- The Team spawn tool and schema expose the lane fields; the tool catalog is regenerated.

## Verification

- Descriptor v4/v3 read-only/v3-with-v4-field/future-version unit tests.
- Continuation test starts a lane with `agentPreset: reviewing` and a temp cwd, then proves the v4 descriptor, child header preset/cwd, and preset mount.
- Tool-team test proves `spawn_teammate` forwards `preset`/`cwd` into `spawnTeammate`.
- The subagent, Team, driver, and spawn suites pass (481 tests, 2 skipped); typecheck, tool-catalog regeneration, and documentation gates rerun with the slice.

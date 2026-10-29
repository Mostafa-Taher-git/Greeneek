# Agent Note: Retired presets stay resolvable but leave creation surfaces

Status: implemented

## Problem

PTC was recalled from the new-session row by a client-held id set and a host-side special case for its default. That left two homes for the same fact: a shipped preset could be retired in copy without any roster-visible marker, and Settings still listed it as a startable mode. A new retired preset would need both a host change and a client change.

## Decision

`preset.yml` may declare `retired: true`. Discovery carries it on `AgentPreset`, the client-safe `AgentPresetRow` reports it, and both the new-session row and the Settings roster filter it. The composition, document read, `resolve('ptc')`, and explicit session selection still work, so a recorded PTC session replays its own composition and never silently becomes Standard. The unnamed-default sanitizer remains keyed to the shipped `ptc` id because only that stored default needs substitution; a user-authored preset reusing the id stays untouched.

The `ptc` preset now ships `retired: true` instead of relying on a client-only id set. No PTC preset was deleted: a read-only census of the owner's default `C:\Users\Sultan\.gnk` home found zero session JSONL files and therefore zero recorded PTC sessions, but deleting the preset also needs the owner's explicit approval and was not part of this decision.

## Alternatives considered

- **Keep a client id set and a host special case.** The two copies drift; a new retired preset would still appear in one surface.
- **Delete the PTC preset after the zero-session census.** Zero sessions prove nothing breaks today, not that the owner wants the composition removed; deletion stays behind explicit approval.
- **Hide the preset from the roster entirely.** A hidden broken directory would strand its id with no surface to inspect or delete it; the roster keeps the row and the surfaces that offer new sessions filter it.

## Consequences

- A retired preset is one metadata fact; creation and Settings surfaces share the filter.
- Explicit PTC replay and custom presets that reuse the id are unchanged.
- The shipped roster still lists PTC with `retired: true`, which is what tests and diagnostics read.

## Verification

- Metadata tests read and render the marker; the shipped-roster test asserts PTC is the only retired shipped preset.
- The existing sanitizer and explicit-resolve tests still pass; the seat fixture marks PTC retired and proves the pill is absent while the roster still supplies it.
- Documentation gates and the preset suites run with the change.

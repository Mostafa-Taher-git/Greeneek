# Agent Note: One React copy via overrides; act-flushed timer tests

Status: implemented

## Problem

With the lint gate repaired, CI's test stage ran for the first time in
a while and failed 1416 tests across 99 files. The failures shared one
signature (`A React Element from an older version of React was
rendered`, empty renders): client packages still declare
`react/react-dom ^18.2.0` while the tree ships and runs 19.2.6, so pnpm
installed both majors and peer slots split per importer.

## Decision

`pnpm-workspace.yaml` overrides pin `react` and `react-dom` to 19.2.6
(the version the browser bundle and landing already run), with a
comment naming the stale ranges as the reason and the removal
condition. One anchor, no 44-manifest churn, and pnpm cannot split peer
slots again. `@types/react` stays on 18 (compile-time only; tsc is
green) to keep the blast radius minimal.

The remaining failures were each root-caused individually, not
bulk-patched:

- Obsolete `minimal` preset test removed with its deleted product
  surface (commit `5d9e76fe` removed Minimal mode).
- Seven timer-then-assert suites (four copy-label, agent-preset toast,
  subagent lineage) wrapped their `advanceTimersByTime*` in
  `await act(async …)`: React 19 does not flush the timeout's state
  update outside `act`, so post-timer queries read stale DOM.
- Models draft seat: the extension seat dispatched from stale rows
  during the reload's `loading` render. The seat now treats a loading
  directory as unconfirmed (the documented intent already said a
  dropped row dispatches nothing); the draft card itself stays open.
- Seven full-round radii gained the `corner-shape: round` pairing the
  design-system gate requires (circles deform to squircles under the
  global superellipse otherwise).

## Alternatives considered

**Update all 44 manifests to `^19`.** Rejected for now: large churn
that still permits future splits, while the override guarantees one
copy. Ranges can be modernized package by package later.

**Move typert generator scratch to tmpdir.** Attempted and reverted:
fixture type and runtime imports resolve through ancestor
`node_modules`, so in-tree scratch is load-bearing (66 failures on the
attempt). The committed residue was instead deleted and the scratch
patterns ignored in oxlint and gitignore.

## Consequences

Full unit suite went from 1416 failures to zero attributable causes
(the only remaining flakes are load-sensitive timeouts that pass solo:
the oxlint-contract retry test and the python wide-value perf test).
Component tests that advance fake timers must wrap the advance in
`await act(async …)` — the React 19 rule going forward.

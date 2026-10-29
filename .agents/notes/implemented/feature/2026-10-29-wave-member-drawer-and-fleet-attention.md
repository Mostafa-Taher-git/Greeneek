# Agent Note: The Fleet row opens a member drawer, the panel follows the first wave, and the fleet speaks

Status: implemented

## Problem

The P2-05 Fleet contract asked for three things the compact rows could not carry. Artifact pointers, the model route, the full diagnostic, and the child-transcript action were crammed into or beside one tight row; the details panel stayed on the Tool body when a Lead started its first wave, so the fleet was invisible unless the reader found the tab; and wave/member transitions were only visual, leaving screen-reader users without an announcement.

## Decision

One member drawer at a time, opened by the row's own disclosure button. The row keeps the role, status, last tool, duration, and spend; the drawer carries the provider, model, every validated artifact pointer, the full diagnostic, and the child-session action. The stop controls stay outside the drawer, on the row. Visibility is the row button's `aria-expanded`, so a second row click closes it and opening another closes the first. The artifact-count chip and its locale key are retired.

The details panel watches the loaded Chat window for `wave_dispatch` — root or nested, running or settled — and flips to the Fleet tab once, on the empty→active edge. The latch is set on that edge and never resets; an explicit Tool selection, a chosen tab, or a missing Fleet seat suppresses the pick, and a later wave cannot steal the panel back. The Fleet seat must already exist when the edge arrives; a tab that appears later does not replay the pick.

The Fleet body keeps a polite live region that diffs consecutive samples. The first non-loading sample is folded in silently, so opening a panel mid-flight does not narrate the fleet it found. It announces a new open wave, a closed wave, and a member that reaches a terminal status; token and tool updates stay silent. Transition lines join into one sentence.

## Alternatives considered

- **Rows expanding in place with all facts inline.** The compact row would become a card and push the stop controls away from the identity they stop; a single drawer keeps one long-form reading surface.
- **Auto-select on every poll while a wave is active.** That repeatedly steals the Tool body from a reader who clicked a transcript row; the one-shot edge is the plan's stronger-intent rule.
- **Announce every sample or every token.** A poll per second would flood the live region; only wave/member lifecycle transitions are news.

## Consequences

- A reader can inspect one member's provenance without losing the compact fleet overview; artifact pointers are readable in full rather than as a count chip.
- The first dispatch in a session brings the fleet to the foreground once; subsequent reader choices are never undone by a later wave.
- The live region remains in the accessibility tree while loading, empty, and populated, so the first transition is announced rather than lost to a late mount.
- The drawer and announcement state are component-local; the fleet mirror remains the single data home.

## Verification

- ui-wave 80 tests and ui-chat details 13 tests, including the row disclosure, one-at-a-time drawer, artifact/provider/diagnostic/child content, auto-pick on the nested and running dispatch edges, Tool-selection and tab suppression, missing-seat suppression, and wave/member announcements.
- The full ui-wave and ui-chat suites are re-run with the icon change; the Dashboard icon is a 1.25-stroke 2×2 pane grid alongside New Session and Settings.

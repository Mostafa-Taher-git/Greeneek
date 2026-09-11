# Agent Note: Effort picker back to the named-level list

Status: implemented

## Problem

The composer effort control was a Power Slider (September 6), but the
standing request is the pre-rebrand interaction: named levels to
pick from. Neither the pre-rebrand app nor the upstream thinking
vocabulary ever had an "Ultra" level — Max is the top — so the
restoration keeps the exact level set and changes only the interaction
back to the list.

## Decision

The effort pane renders one `menuitemradio` row per level
(Default/Low/Medium/High/Extra High/Max) in canonical escalation
order, with the active level checked and `off`/`minimal` unoffered, and
a pick selects and dismisses like the model list (`chooseEffort` keeps
its default dismiss path; the slider's live `dismiss=false` call is
gone). The slider component, its track/dot CSS, the range-keyboard
carve-out, and the readout/fill/dot specs are deleted with it — no dead
code stays behind the switch.

## Alternatives considered

**An "Ultra" stop above Max.** Rejected: no upstream thinking level
exists above `max`, so a stop would name a level requests cannot send.
`max: ultra` in the adapter docs is a per-model wire spelling for Max,
not a separate level.

**Keeping both slider and list.** Rejected: two interactions for one
choice doubles the pane's test and a11y surface for no new capability.

## Consequences

Unit specs assert rows, order, checked state, descriptions never
rendering, and single-shot dismiss; the declared-reasoning web e2e
asserts the six rows, the golden aria snapshot, the settings write, and
dismissal, green in both refresh and replay. The corner-shape design
gate stays green with the slider CSS gone (removed selectors need no
pairing).

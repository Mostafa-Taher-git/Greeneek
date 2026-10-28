# Agent Note: Directional client CSS is logical-property first

Status: implemented

## Problem

The web shell renders right-to-left locales by setting `<html dir="rtl">`. Client stylesheets pinned geometry to the physical left/right axes — `margin-left`, `padding-right`, `text-align: left`, `left`/`right` insets, `translateX` drifts, and sweep keyframes — so under RTL every surface laid out and animated as if reading were left-to-right: text hugged the wrong edge, seams and scrollbars sat on the wrong side, and entrance animations drifted the wrong way.

## Decision

Direction-sensitive declarations use logical properties: `margin`/`padding`/`border` `inline-start`/`inline-end` longhands, `inset-inline`/`inset-block`, and `text-align: start`/`end`. Asymmetric four-value shorthands split into block/inline pairs so the horizontal values follow the reading direction; a full-bleed inset pair collapses to `inset-inline`.

Physical axes without a logical form stay physical with an explicit mirror: `[dir='rtl']` selector overrides for `translateX` transforms, box-shadow x-offsets, background positions, and gradient angles, and mirrored `@keyframes` variants with an `animation-name` switch for entrance and sweep animations (SidebarRoot's `rail-in`/`neon-expand-in`/`neon-sweep`, TurnNavigator's `gnk-turn-preview-enter`). Keyframes whose stops animate an offset convert to `inset-inline-start`, which mirrors on its own.

Scale, time-axis, and code domains — TrajectoryTimeline's time axis, EffortSlider's fraction knob, JsonTree, DiffBlock, TerminalBlock — force `direction: ltr` on their root with a comment: their positions encode a value, not a reading direction.

`scripts/verify-logical-css.ts` enforces the rule over `packages/client/**/*.css` (built output excluded). It rejects the renamed directional properties, `text-align: left`/`right`, asymmetric four-value `margin`/`padding`/`inset` shorthands (a paren-aware tokenizer keeps `calc(...)` one token), physical `left`/`right` declarations outside a `[dir='rtl']` block (blocks carry their selector chain, so at-rule preludes do not inherit an inner override), and transition lists naming a renamed property — a stale name stops the animation silently. A per-file allowlist with recorded reasons admits direction-neutral centering, script-computed offsets, and forced-LTR scopes, and excuses only physical offsets and the transition lists that animate them. The gate runs in the client surface gates aggregate. Style-pin specs read the logical names; pinned values are unchanged.

## Alternatives considered

- **Manual review only.** The 82-file corpus and the silent failure modes (a stale transition name, an unmirrored transform) make review-only unreliable; the executed gate rejects each form.
- **A Stylelint logical-property plugin.** A second lint stack would still lack the RTL-block admission, keyframe handling, and per-file reasoned allowlist this boundary needs; the custom parser covers the exact rule in one place.
- **Convert transforms with logical keywords.** CSS has no logical translate axis; mirrored overrides are the only mechanism.

## Consequences

- Left-to-right rendering is identical by construction: every conversion changes only axis naming, never values.
- New client CSS fails the gate until it uses logical forms or a reasoned allowlist entry.
- A transition animating a directional property must name the logical property; the gate rejects the stale name.
- Allowlisted files keep their physical declarations; a new physical inset in a forced-LTR or script-driven component needs an allowlist reason.

## Verification

- The 27-test spec exercises every admitted and excluded form; the repository corpus (131 files) passes.
- `pnpm run test:gui` 4178 passed / 1 skipped, including the three style-pin specs re-pinned to the logical names with identical values.
- Theme contrast, duplication (0 clones), full typecheck, `lint:contracts-ready`, and `test:docs` green.
- Right-to-left browser coverage, bidi isolation, and the native Arabic review stay with the web RTL lane and the owner review, recorded in the release plan's verification matrix.

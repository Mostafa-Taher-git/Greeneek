# Agent Note: Directional client CSS is logical-property first

Status: implemented

## Problem

The web shell renders right-to-left locales by setting `<html dir="rtl">`. Client stylesheets pinned geometry to the physical left/right axes — `margin-left`, `padding-right`, `text-align: left`, `left`/`right` insets, `translateX` drifts, and sweep keyframes — so under RTL every surface laid out and animated as if reading were left-to-right: text hugged the wrong edge, seams and scrollbars sat on the wrong side, and entrance animations drifted the wrong way.

## Decision

Direction-sensitive declarations use logical properties: `margin`/`padding`/`border` `inline-start`/`inline-end` longhands, `inset-inline`/`inset-block`, and `text-align: start`/`end`. Asymmetric four-value shorthands split into block/inline pairs so the horizontal values follow the reading direction; a full-bleed inset pair collapses to `inset-inline`.

Physical axes without a logical form stay physical with an explicit mirror: `[dir='rtl']` selector overrides for `translateX` transforms, box-shadow x-offsets, background positions, and gradient angles, and mirrored `@keyframes` variants with an `animation-name` switch for entrance and sweep animations (SidebarRoot's `rail-in`/`neon-expand-in`/`neon-sweep`, TurnNavigator's `gnk-turn-preview-enter`). Keyframes whose stops animate an offset convert to `inset-inline-start`, which mirrors on its own.

Scale, time-axis, and code domains — TrajectoryTimeline's time axis, EffortSlider's fraction knob, JsonTree, DiffBlock, TerminalBlock — force `direction: ltr` on their root with a comment: their positions encode a value, not a reading direction.

`scripts/verify-logical-css.ts` enforces the rule over the client stylesheets — `packages/client/**/*.css` plus every package's `src/client/**/*.css`, so browser packages outside the client group are covered (built output excluded). It rejects the renamed directional properties, `text-align: left`/`right`, asymmetric four-value `margin`/`padding`/`inset` shorthands (a paren-aware tokenizer keeps `calc(...)` one token), physical `left`/`right` declarations outside a `[dir='rtl']` block (blocks carry their selector chain, so at-rule preludes do not inherit an inner override), and transition lists naming a renamed property — a stale name stops the animation silently. A per-declaration allowlist admits direction-neutral centering, script-computed offsets, and forced-LTR scopes only where the owning selector and property are named with a recorded reason; a new physical offset in an admitted file fails until it gets its own entry, and an entry that matches nothing fails as stale. The gate runs in the client surface gates aggregate. Style-pin specs read the logical names; pinned values are unchanged.

Portal surfaces resolve `start`/`end` against the document direction: the Menu primitive derives the physical left from the anchor's logical edge, `.portal` resets the inherited logical inset so it cannot pin the card to `right: 0` under RTL, and `useAnchoredPosition` aligns a panel's reading-start edge. Message prose uses `unicode-bidi: plaintext`, so each paragraph follows its first strong character — an English reply keeps LTR order and punctuation inside the Arabic shell — while an explicit `[dir='rtl']` rule keeps those paragraphs on the shell's start edge. Inline code and code blocks stay LTR and isolated, and titles that may be Latin carry `dir="auto"` so ellipsis trims the end rather than the beginning.

## Alternatives considered

- **Manual review only.** The 82-file corpus and the silent failure modes (a stale transition name, an unmirrored transform) make review-only unreliable; the executed gate rejects each form.
- **A Stylelint logical-property plugin.** A second lint stack would still lack the RTL-block admission, keyframe handling, and per-file reasoned allowlist this boundary needs; the custom parser covers the exact rule in one place.
- **Convert transforms with logical keywords.** CSS has no logical translate axis; mirrored overrides are the only mechanism.

## Consequences

- Left-to-right rendering is identical by construction: every conversion changes only axis naming, never values.
- New client CSS fails the gate until it uses logical forms or a reasoned allowlist entry.
- A transition animating a directional property must name the logical property; the gate rejects the stale name.
- Allowlisted files keep only their recorded physical declarations; a new physical inset in a forced-LTR or script-driven component fails until its selector and property are admitted with a reason, and an entry that stops matching the CSS fails as stale.
- Plugin browser packages outside `packages/client` follow the same rule: the Cordis definition card, inventory panel, and run row, plus the session-log export header, use logical geometry, and the inventory panel's measured anchor follows the reading direction.
- English and Arabic prose share the same message column: `unicode-bidi: plaintext` sets each paragraph's base direction from its first strong character, and a `[dir='rtl']` alignment rule keeps both directions on the shell's start edge. Inline code is isolated LTR; a title that may be Latin uses `dir="auto"`.
- Portal menus and anchored panels mirror their anchor in RTL; a menu card no longer inherits `right: 0` from its logical base inset.

## Verification

- The 33-test spec exercises every admitted and excluded form, the plugin-package corpus, declaration-scoped admissions, stale entries, and an explicit RTL text-alignment override; the repository corpus (135 files) passes.
- A Chromium audit at 1440×900 and 900×800 in light and dark, with Arabic and English content, found no horizontal overflow, no clipped settings label, correctly mirrored workspace/menu/usage panels, and English prose retaining its word order on the right-hand start edge. The only elision is an intentionally truncated session title.
- `pnpm run test:gui` 4178 passed / 1 skipped, including the three style-pin specs re-pinned to the logical names with identical values.
- Theme contrast, duplication (0 clones), full typecheck, `lint:contracts-ready`, and `test:docs` green.
- Right-to-left browser coverage, bidi isolation, and the native Arabic review stay with the web RTL lane and the owner review, recorded in the release plan's verification matrix.

# Agent Note: Light-theme contrast gate

Status: implemented

## Problem

The v0.3.4 light appearance was anchored at `#EEEEEE` and its text ladder was measured by hand: an Agent Note recorded `--dsw-alias-label-caption` at 3.40:1 against the base and stopped there. Nothing executed those numbers, so the release carried at least three roles below the WCAG 2.x AA target it claimed — caption at 3.40:1, `--dsw-alias-label-dimmed` (the `::placeholder` and `:disabled` colour) at 1.50:1, and markdown link text at 3.92:1 — and a maintainer lightening any token in `packages/client/ui-theme/src/styles/design-platform.css` met no resistance. The milestone gate for the theme work asks for executable checks over every text role, every interaction state, and every surface, not another recorded table.

## Decision

`scripts/verify-theme-contrast.ts` is a repository gate registered as `pnpm run verify-theme-contrast` and scheduled in `ciSharedStaticGates` and `hygieneLeafGates` (`check:ci`, `check:ci:static`, `hygiene`, `check:all`). Its spec `scripts/verify-theme-contrast.spec.ts` runs in the ordinary `pnpm run test` lane and proves each rejection path.

The gate reads colour from `design-platform.css` and never restates a value: it collects the declarations of every unqualified `body { … }` block — the light appearance — resolves `var()` indirection to channels, and computes WCAG relative luminance and contrast ratios. `body[data-ds-dark-theme]` blocks are excluded by selector, which the spec pins by asserting the light reading of a name the dark block redeclares. A token that stops existing, a value the parser cannot resolve (`color-mix`, `calc`), a `var()` cycle, a self-referential alias, and an alpha surface with no named backdrop all throw instead of being skipped.

The table `LIGHT_CONTRAST_CHECKS` is the part this file owns: each row pairs one role token with the surfaces the shipped CSS paints under it, the WCAG target, and the font size and weight that select the target.

- Normal-size text roles take 4.5:1: `label-primary`, `label-primary-dimmed`, `label-secondary`, `label-tertiary`, `label-caption`, `label-dimmed` (placeholder and disabled asserted separately because one token carries both), `label-primary-bluish`, and `state-business-primary` as markdown link and chip text. All of these render between 11px/400 and 16px/400; the largest role, markdown `h1` at 21px/700, stays at 4.5:1 because the same token also paints 11px captions.
- Foreground and inverted roles take 4.5:1 against the fills that carry them: `label-primary-foreground` (white on brand, info, and brand-hover fills) and `label-primary-inverted` (white on the contrast fill, ink, toast, and tooltip backgrounds).
- Non-text affordances take 3:1 under SC 1.4.11: the brand focus stroke, the `button-ghost-active-border` hairline that carries the selected state on `#D2D2D2`, and both scrollbar thumb pairs against every rung they scroll over (`scrollbar.css` keeps the track transparent, so the adjacent colour is the surface itself).

A role is asserted only against a fill that really carries its text. `label-tertiary` is not paired with the `#DADADA` solid hover fill because no rule paints it there, and `label-caption` is not paired with the brand-tint pill for the same reason. Inventing those pairings would have forced two text roles onto one value and flattened the ladder further than accessibility requires.

Translucent surfaces composite before measurement: `--dsw-alias-interactive-bg-hover` is `rgba(50, 131, 82, 0.06)`, and over `#EEEEEE` it lands darker than the base, so the accent hover wash is a stricter test than the base rung, not a softer one.

Signal hues are out of scope, and the gate says so at the top of the file: `state-success-*`, `state-warn-*`, and `state-error-*` are not in the table, and `TODO(theme-contrast)` names diff add and delete lines as the worst known cases (`--dsw-static-green-500` measures 1.83:1 on the `#E6E6E6` code block, `--dsw-static-red-600` 3.60:1). The ladder this gate checks is the [light appearance anchored at #EEEEEE](../feature/2026-10-24-v0.3.4-light-ramp-eeeeee.md).

## Alternatives considered

**Keep the manual contrast table in the Agent Note.** Rejected: the milestone gate exists because the table did not stop a 3.40:1 caption from shipping, and a table cannot fail.

**Cross-multiply every label role against every light surface.** Rejected: `#C8C8C8` and `#D2D2D2` would demand 4.5:1 there, which forces caption, tertiary, and secondary onto one ink value. The pairing table is the difference between a check and a lie; each row is justified by a rule in a consumer stylesheet.

**Add a dependency that computes contrast.** Rejected: the calculation is WCAG's published relative-luminance formula, roughly twenty lines, and `package-dependencies` plus the dependency-over-hand-rolling policy require a maintained dependency to delete owned code, not to add one.

**Set the target from the token name rather than the typography.** Rejected: names do not carry size. Each row records the `basis` — the font shorthand or pixel size the shipped CSS assigns — so a role that moves to large text can drop to 3:1 with the evidence in the same line.

**Bring signal hues into the table in the same change.** Rejected for this PR, not on principle: the light appearance decision pins success/warn/error to their original green/amber/red hues, they feed dots, pills, borders, and the model-select focus ring as well as text, and every one of those renders in the keyed browser-snapshot corpus. Recolouring them without a `GREENEEK_API_KEY` to re-record would trade a checked guarantee for an unchecked one.

## Consequences

- Six role tokens moved, all inside the approved neutral and brand-green families: light `-bluish-400` `rgb(128, ·)` → `rgb(103, ·)` (caption), light `-bluish-200` `rgb(196, ·)` → `rgb(108, ·)` (placeholder and disabled), light `--dsw-static-neutral-200/300` `rgb(196, ·)`/`rgb(177, ·)` → `rgb(132, ·)`/`rgb(112, ·)` (scrollbar thumb and its hover), and light `--dsw-alias-state-business-primary` `greeneek-500` → `greeneek-600` (link text). Both `body[data-ds-dark-theme]` blocks are byte-identical to before.
- The light text ladder now reads 108 / 103 / 98 / 90 for dimmed / caption / tertiary / secondary. 4.5:1 against `#EEEEEE` requires `rgb(108, ·)` or darker, so the ladder has about 20 levels in total and placeholder text is visibly closer to caption text than the previous design intended. No shipped test pins any of the six values, and the `apps/web/tests/seeded-history.e2e.ts` pins (`rgb(230, 230, 230)` fill, `rgb(98, 98, 98)` tertiary text) still match what the CSS resolves to.
- `-bluish-500` (`rgb(118, ·)`, the selected-state hairline) is lighter than `-bluish-400`, so the step numbers no longer read as one monotone scale. They never were a single scale — `-750` is brand green and `-800` through `-1000` are surfaces — and the comment above the light block states which steps are text and which are non-text.
- `--dsw-static-neutral-bluish-400` is also a direct `border-color` and meter tint in `AgentPresetSection.module.css`, `AppearanceRow.module.css`, and `ContextMeter.module.css`; those edges darken with the caption step.
- The gate measures 17 roles across 151 role/surface pairings. A role can now only leave the table by editing `LIGHT_CONTRAST_CHECKS`, and the spec rejects a deleted row, a lightened token, and a missing token.
- Known uncovered: signal-hue text and the model-select slider focus ring (`--dsw-alias-state-success-primary` at 1.96:1 on the base as a non-text indicator), the photo-mask caption pair (its backdrop is arbitrary image content, not a token), and any role in a package another agent owns. These are recorded here and in the gate's module comment rather than left silent.

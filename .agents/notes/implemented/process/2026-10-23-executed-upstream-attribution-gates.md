# Agent Note: Executed upstream attribution gates

Status: implemented

## Problem

The fork's brand sweep stripped every upstream identity mechanically, including legal attribution: `LICENSE` lost the DeepSeek copyright line the MIT license text requires, and the README carried no fork-origin statement. The build reproducibility gate `brand-sweep` had no check that caught an attribution strip, so a future rebrand edit could ship a licence violation in a green CI run. GitHub issue #77.

## Decision

Attribution is now an executed top-level gate, not a convention. `scripts/brand-sweep.sh` runs three checks in order — `verify-attribution.mjs` (new), the residue scan (`verify-brand-residue.mjs`), and the egress check — so a run that strips upstream attribution fails before residue or network checks report anything.

`verify-attribution.mjs` rejects a tree where `LICENSE` does not carry both copyright notices (DeepSeek upstream first, then this fork, both MIT years as-shipped), where the README's "Origins and attribution" section is missing or outside its `rebrand:ignore-start` / `rebrand:ignore-end` markers, and where `THIRD_PARTY_NOTICES.md` drops the `## Upstream harness` fork record. The negative side is covered by the gate's own self-test: removing either LICENSE line, deleting the README section, or dropping the notices section each fail the check.

The notices source of truth is the generator: `scripts/gen-third-party-notices.ts` carries the `UPSTREAM_HARNESS` record (fork point commit `818c4f344e`, upstream release `0.1.2-rc.1`, dated 2026-09-03), and `THIRD_PARTY_NOTICES.md` is its rendered output. The residue allowlist pins exactly the files allowed to say "DeepSeek": `README.md`, the notices generator, the `onboarding-usable-provider/` expected snapshot, and the `sign-in-dialog.client.spec.tsx` provider-catalog test, because deepseek is one of the shippable provider ids a user can configure.

## Alternatives considered

**Document attribution policy and trust review.** Rejected: the same review window that removed it "mechanically" shows the strip sliding through review; the residue gate already proved executed checks hold across rebrand edits.

**Restore attribution only in the release pipeline.** Rejected: the development tree and the published artifact must carry the same licence text, or every intermediate artifact misstates the copyright.

## Consequences

The repository's next rebrand-shape edit cannot remove the upstream copyright, the README fork statement, or the notices record without a red brand sweep and an allowlist change naming the file — the same review bar the residue scan already imposes. The three allowlisted files are the only intentional DeepSeek-string sources, keeping `rebrand:dry` at zero residue.

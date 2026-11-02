# Agent Note: A shipped patch layer cannot name a row this composition lacks

Status: implemented

## Problem

A patch entry that overrides an id no lower layer carries is skipped. `@greeneek/cordis-plugin-include` reports it as `patch: entry %C not found` on the root logger (`vendor/include/src/index.ts:112`), and a mounted tree that configures no logger drops even that line. The composition then boots looking healthy without the configuration its author wrote.

Two scenarios sat red on exactly this: the `image-offload` expected-output fixture carried a bare `- id: llm-greeneek` override while `packages/bundle/base/cordis.patch.yml:540-552` deliberately does not mount the native adapter, and `greeneek-defaults` had the same form. Both files first had to be diagnosed from the symptom (no adapter registered for provider `greeneek-official`) rather than from the composition that caused it.

The warning is not a bug. `packages/boot/app-boot/src/index.ts:322-334` records why it exists: one overlay shared across surfaces must not be required to match every tree. Refusing unmatched rows everywhere would make `$GNK_HOME/cordis.patch.yml` and `--patch` overlays unusable on any profile that does not carry every row they mention.

## Decision

**Strictness is a property of the layer, not of the patch algorithm.** `NamedPatchLayer` (`packages/boot/app-boot/src/profile.ts`) carries a `strict` flag; `checkPatchComposition(binName, layers, warn)` refuses the first strict layer whose patch the mount would drop and routes every lenient diagnostic to `warn`. Shipped bundle layers and a profile's own `cordis.patch.yml` are strict — they are written beside the rows they target. The home layer and each `--patch` overlay stay lenient, preserving the documented shared-overlay capability.

**The check reproduces the mount's composition, not an approximation of it.** Each prefix of the layer list is composed as one flattened `applyEntryPatches` call over the empty root through the existing `composeEntries`, exactly as the include does at mount, and warnings are attributed to the layer whose prefix first produced them. So a row a lower layer inserts satisfies an upper override with no diagnostic, and an override naming a row only a *later* layer inserts is still refused — the mount skips it in that order too. `renderConfigDump` already used this per-prefix attribution; the guard follows it rather than inventing a second model.

**The refusal happens before anything mounts.** `composeProfile` in `apps/cli/src/profile-boot.ts` calls the check with the same layer list it goes on to compose, after the profile and its bundles are resolved and before `boot()`. The error names the layer, the include's own line, and the remedy: add the row with `- insert:` or target an id a lower layer declares.

**`--dump-config` refuses under the same rule.** A dump that printed a tree the same invocation's boot would refuse would mislead, which is the reasoning `args.spec.ts` already applies to app arguments. The dump marks its bundle and profile layers strict and discards the lenient sink, since `renderConfigDump` prints those rows with their layer label itself — no doubled output.

**Safe mode skips the profile layer in both places.** `GNK_SAFE_MODE` drops the profile's own layer from the boot composition, so the guard omits it from the strict set rather than refusing a profile it is not applying.

## Alternatives considered

**Refuse unmatched rows inside the vendored include.** Rejected: the include's lenient behavior is the documented contract for shared overlays, and this is a policy about *which author* wrote the row — a harness concern, not a loader concern. It also avoids a logged local modification that every vendor sync must re-apply.

**Make every layer strict.** Rejected: it breaks `$GNK_HOME/cordis.patch.yml` and shipped `config/examples/` overlays that apply to some profiles and not others.

**Leave overlays silent and refuse only shipped layers.** Rejected: it fixes half the complaint. The motivating fixtures are `--patch` files, and an overlay row dropped without a trace is how those scenarios stayed undiagnosed. They now print with their file name.

## Verification

`pnpm exec vitest run packages/boot apps/cli/tests/shipped-patch-composition.spec.ts apps/cli/tests/args.spec.ts` → 169 tests / 11 files. `packages/boot/app-boot/tests/patch-composition.spec.ts` pins the refusal text, the lenient report, cross-layer satisfaction, the later-insert ordering rule, per-layer attribution across two rows, the empty stack, and the stderr default sink; `profile.ts` holds 100% statements/branches/functions/lines under the coverage thresholds. `apps/cli/tests/shipped-patch-composition.spec.ts` reads the real `packages/bundle` patches in each `PROFILE_TEMPLATES` order and asserts no shipped template trips the guard. Live, against a temporary `GNK_HOME`: a profile layer naming `this-row-exists-nowhere` → exit 1 with the remedy; the same row in a `--patch` overlay → exit 0 with `gnk: [...bad-overlay.yml] patch: entry "overlay-row-missing-here" not found`; a clean profile still dumps. `tsc -b tsconfig.host.json` exit 0.

## Consequences

Every shipped patch row now has to name something the composition carries, so a bundle that stops mounting a plugin must also drop or convert the rows that configured it — `agent-team-web-profile`'s deletion in this release is exactly that shape of follow-up. The rule costs one extra flattened composition pass per layer prefix at profile resolution, before any plugin is imported, so a failure names the offending file instead of a downstream runtime symptom.

Out-of-tree bundles installed through `gnk plugin add` are strict too: their patch files are authored beside the rows they declare, and a bundle that expects an optional host to supply a row must gate the row itself rather than override it.

## Related

- [Loader configuration](../../../../docs/cordis-primer.md#loader-configuration)
- [CLI behavior reference](../../../../apps/cli/reference/README.md)

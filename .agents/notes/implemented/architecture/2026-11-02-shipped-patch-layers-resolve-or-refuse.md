# Agent Note: A shipped patch layer cannot name a row this composition lacks

Status: implemented

## Problem

A patch entry that overrides an id no lower layer carries is skipped. `@greeneek/cordis-plugin-include` reports it as `patch: entry %C not found` on the root logger (`vendor/include/src/index.ts:112`), and a mounted tree that configures no logger drops even that line. The composition then boots looking healthy without the configuration its author wrote.

Two scenarios sat red on exactly this: the `image-offload` expected-output fixture carried a bare `- id: llm-greeneek` override while `packages/bundle/base/cordis.patch.yml:540-552` deliberately does not mount the native adapter, and `greeneek-defaults` had the same form. Both files first had to be diagnosed from the symptom (no adapter registered for provider `greeneek-official`) rather than from the composition that caused it.

The warning is not a bug. `packages/boot/app-boot/src/index.ts:322-334` records why it exists: one overlay shared across surfaces must not be required to match every tree. Refusing unmatched rows everywhere would make `$GNK_HOME/cordis.patch.yml` and `--patch` overlays unusable on any profile that does not carry every row they mention.

## Decision

**Strictness is a property of the layer, not of the patch algorithm.** `NamedPatchLayer` (`packages/boot/app-boot/src/profile.ts`) carries a `strict` flag; `checkPatchComposition(binName, layers)` refuses the first strict layer whose patch the mount would drop and changes nothing for a lenient one. Shipped bundle layers and a profile's own `cordis.patch.yml` are strict — they are written beside the rows they target. The home layer and each `--patch` overlay stay lenient, preserving the documented shared-overlay capability.

**The boot path stays silent about a lenient skip.** Its visibility already exists on two channels this repository owns: the mounted include logs `patch: entry %C not found` through `ctx.root.logger`, and `--dump-config` prints it with the layer label (`apps/cli/reference/README.md` documents that). Echoing it from `composeProfile` as well was tried and broke CI: `snapshots/session/headless.snapshot.ts` asserts an empty stderr as the success signal for a keyless replay, and the recorded `--patch` fixtures legitimately override `llm-greeneek` in a composition that mounts the snapshot provider row instead — a correct lenient skip turned into 77 failed snapshots. `packages/boot/app-boot/tests/patch-composition.spec.ts` now pins that this path writes nothing to stderr.

**The check reproduces the mount's composition, not an approximation of it.** Each prefix of the layer list is composed as one flattened `applyEntryPatches` call over the empty root through the existing `composeEntries`, exactly as the include does at mount, and warnings are attributed to the layer whose prefix first produced them. So a row a lower layer inserts satisfies an upper override with no diagnostic, and an override naming a row only a *later* layer inserts is still refused — the mount skips it in that order too. `renderConfigDump` already used this per-prefix attribution; the guard follows it rather than inventing a second model.

**The refusal happens before anything mounts.** `composeProfile` in `apps/cli/src/profile-boot.ts` calls the check with the same layer list it goes on to compose, after the profile and its bundles are resolved and before `boot()`. The error names the layer, the include's own line, and the remedy: add the row with `- insert:` or target an id a lower layer declares.

**`--dump-config` refuses under the same rule.** A dump that printed a tree the same invocation's boot would refuse would mislead, which is the reasoning `args.spec.ts` already applies to app arguments. The dump marks its bundle and profile layers strict; its lenient rows keep the label-bearing line `renderConfigDump` already emitted.

**Safe mode skips the profile layer in both places.** `GNK_SAFE_MODE` drops the profile's own layer from the boot composition, so the guard omits it from the strict set rather than refusing a profile it is not applying.

## Alternatives considered

**Refuse unmatched rows inside the vendored include.** Rejected: the include's lenient behavior is the documented contract for shared overlays, and this is a policy about *which author* wrote the row — a harness concern, not a loader concern. It also avoids a logged local modification that every vendor sync must re-apply.

**Make every layer strict.** Rejected: it breaks `$GNK_HOME/cordis.patch.yml` and shipped `config/examples/` overlays that apply to some profiles and not others.

**Print lenient skips on the boot's stderr as well.** Rejected after it shipped and failed: recorded `--patch` overlays legitimately override a row that only the live-provider composition carries, so the recorded-session fixtures produced a correct skip on every keyless replay, and the suite reads a non-empty stderr as a failed boot. A diagnostic that is noise for one surface and vital for another belongs on the surface that can tell them apart — the loader logger (which knows the mounted tree) and `--dump-config` (which exists to be inspected), not the launcher's exit channel.

## Verification

`pnpm exec vitest run packages/boot/app-boot` → 142 tests / 8 files. `packages/boot/app-boot/tests/patch-composition.spec.ts` pins the refusal text and remedy, the lenient tolerance, cross-layer satisfaction, the later-insert ordering rule, blame on the strict layer rather than the lenient one above it, the empty stack, and that the path writes nothing to stderr; `profile.ts` holds 100% statements/branches/functions/lines under the coverage thresholds. `apps/cli/tests/shipped-patch-composition.spec.ts` reads the real `packages/bundle` patches in each `PROFILE_TEMPLATES` order and asserts no shipped template trips the guard. Live, against a temporary `GNK_HOME`: a profile layer naming `this-row-exists-nowhere` → exit 1 with the remedy; a clean profile still dumps. After the stderr revert, `pnpm run test:snapshot -- -t "bash-tool-turn"` no longer raises the stderr assertion at all — its only remaining local difference is the `bash` tool-result body, this host running `pwsh` where the lane is POSIX-authoritative. `tsc -b tsconfig.host.json` exit 0.

## Consequences

Every shipped patch row now has to name something the composition carries, so a bundle that stops mounting a plugin must also drop or convert the rows that configured it — `agent-team-web-profile`'s deletion in this release is exactly that shape of follow-up. The rule costs one extra flattened composition pass per layer prefix at profile resolution, before any plugin is imported, so a failure names the offending file instead of a downstream runtime symptom.

Out-of-tree bundles installed through `gnk plugin add` are strict too: their patch files are authored beside the rows they declare, and a bundle that expects an optional host to supply a row must gate the row itself rather than override it.

## Related

- [Loader configuration](../../../../docs/cordis-primer.md#loader-configuration)
- [CLI behavior reference](../../../../apps/cli/reference/README.md)

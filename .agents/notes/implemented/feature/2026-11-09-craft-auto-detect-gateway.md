# Agent Note: ArtCraft auto-detect gateway discovers any installed app without a hand-written adapter

Status: implemented

## Problem

The v0.3.4 Craft pilot discovers only two hand-written manifests (`photocraft`, `pdfcraft`) and requires an MCP tool registry reviewed against a hand-maintained hash, so every additional ArtCraft app needs a hand-written adapter and a hand-maintained tool filter before it can be used. The `serve` protocol also advertises `engine.commands` and rejects the manifest `command_list` method the transport sends, so a `serve` session cannot list tools at all. The owner rule (Master Plan S5-09) requires one gateway that discovers any installed ArtCraft app from the launcher manifest plus the OS registry, generates its capability matrix from the live command registry at runtime, caches and drift-hashes it, and never trusts first use as a review.

## Decision

One gateway discovers and opens every installed app without a per-app adapter: `craft_list_apps` reports catalog and auto-detected apps alike (`discoveredApps()`), and `craft_open_app` opens any of them.

- **Inventory.** `listInstalledApps()` in `craft-local` enumerates the launcher `installed.json` app map, the launcher `app.ron` `per_app` map, `<id>.portable.txt` markers, every Windows MSI `InstallDir` (`HKLM\Software\<App>` via one recursive `reg query /f InstallDir /s`), and Linux `.desktop` entries under the XDG applications directories. First source wins per id; later sources fill missing fields. No app id, display name, or install path is hard-coded.
- **Synthesis.** An id with no hand-written manifest gets an ephemeral manifest built by `parseManifest` from launcher facts only (`synthesizeManifest`): attach disabled, MCP headless launch without a control-token file, confined roots, `verified: false`, `trustedRegistryHash: null`, and provenance `urn:greeneek:auto-detected:<id>`. The provisional manifest probes with `command_list`; the effective session manifest replaces the filter with the observed tool names, so first use never becomes a recipe.
- **Capability matrix.** `buildCapabilityMatrix()` projects one live registry response (MCP `tools/list`, `serve` `engine.commands`, or a bare `command_list` array) into descriptors and a `sha256:` hash. `JsonRpcCraftTransport.listTools()` for `serve` now projects `engine.commands` instead of sending the rejected `command_list`; only manifests with no observed registry method keep the legacy direct call. `CapabilityCache` keeps the first observed hash as the drift baseline per app; a later differing open throws `CRAFT_APP_NOT_READY`, closes the host, and later `status` reads report `drifted`. A trusted manifest hash still gates recipes; an auto-detected baseline never does.
- **Lazy gateway untouched.** Idle sessions still pay two tool schemas and spawn zero app processes; `toolFilter` mounting, artifact confinement, the concurrency cap, root confinement, the per-launch control token, and the attach hard-gate are unchanged (S5-09c, S5-09d).
- **Launch contract.** Both transports now enforce the full placeholder grammar at manifest load: `{cli}` must open the template and the two confined roots must appear; only the control-token file stays transport-conditional (S5-09f).

## Alternatives considered

**A hand-written manifest per app as the primary path.** Rejected by the owner rule (S5-09a): the launcher already names every installed app, so a manifest per app duplicates inventory that drifts at each app release. Hand-written manifests remain the reviewed path for the two pilots; auto-detected apps use synthesized ephemeral manifests that cannot claim `verified`.

**Trust the launcher manifest as the capability source.** Rejected: `installed.json` declares install directories, not callable tools. Facts come from observed `tools/list` / `engine.commands` responses only (S5-09b), so documentation is never ported into the matrix.

**Probe command presence with `command_list` on `serve`.** Rejected: the installed `serve` peer answers `unknown method command_list`. The transport projects the live `engine.commands` registry instead, matching the observed wire.

**Casting a registry-subkey scan into a hand-maintained list.** Rejected: the recursive `InstallDir` query and the `.desktop` scan enumerate without naming any app, which is what makes an install the user already has become usable without a new manifest.

## Consequences

- An installed app without a manifest is listable and openable, mounts its observed tools, and reports honest `ready` / `not-installed` / `drifted` states; its recipe stays disabled until a reviewed baseline exists.
- Drift detection is process-local: the cache lives on the `CraftRuntime` instance. A restart re-seeds the baseline from the next open; durable cross-restart baselines remain unimplemented and are not claimed.
- Real-app verification (S5-09e, OWN-03) stays open: the 13-app rows other than the two pilots report honest auto-detected or not-installed states, and `verified: true` still requires a recorded artifact-producing run. Linux rows are implemented with fakes and unvalidated against a real install.
- Manifest contracts are unchanged in shape: every synthesized manifest passes the same `parseManifest` strictness as the bundled two.

## Testing

- `packages/craft/craft/tests/capability.spec.ts` — registry projection for all three shapes, empty catalogs, malformed entries, and cache baseline / drift / recovery per app.
- `packages/craft/craft-local/tests/inventory.spec.ts` — `installed.json` app-map enumeration without manifests, launcher-state / portable / OS-registry merge, Linux `.desktop` enumeration, and recursive registry parsing.
- `packages/craft/craft/tests/discovered.spec.ts` — synthesized manifests, catalog-plus-inventory listing, open with an observed filter, drift-unverified reporting, and unknown-app rejection.
- `packages/craft/tool-craft/tests/discovered.spec.ts` — gateway listing and open of an auto-detected app with close / not-open handling.
- `packages/craft/craft/tests/launch-contract.spec.ts` — S5-09f placeholder coverage (missing `{cli}`, missing read/write roots, missing control-token file) on both transports.
- Real `serve` handshake now asserts `engine.commands` twice and never `command_list`.

## Reference ledger (t3code / pandacode, verified 2026-11-09 via webfetch)

- **t3code (`pingdotgg/t3code`, commit `4f0b74e190261c8233ae52af17b0fd1734e99e50`, MIT).** Inspected `apps/server/src/provider/ProviderRegistry.ts` (registry refresh, hydration from `providerStatusCache.ts`, `orderProviderSnapshots`), `ProviderLatestVersions.ts` with `maintenanceResolver.ts` (command-path resolution via `resolveCommandPath`, 1-hour maintenance cache TTL, version probe timeouts), and `VcsDriverRegistry` / ACP registry adapters. Reuse: adapt the catalog-plus-probe-plus-cache shape (inventory enumeration, live probe at open, drift hash, no first-use trust). Decision: adapt, not copy. The Effect-TS host and secret-backed refresh do not transfer; the adopted pattern is the separation of a static catalog from a probed status snapshot with a bounded cache.
- **pandacode (`aicodeking/pandacode`, commit `f28c4df06c1f2d4ca3575eb9db186a2fe7cf8665`, PandaCode License — MIT with an attribution requirement to link the repository).** Inspected `src-tauri/src/providers/launch.rs` (platform-aware launch without a batch shell, extended-namespace path handling), `src/provider-readiness.ts` (`provider_check_connection`: installation alone never establishes readiness), and `src-tauri/src/panda_router/data/harness_map.json` (static provider metadata, not live capability facts). Reuse: adopt explicit readiness checks over install-state inference and platform-isolated path handling. Decision: adapt, not copy. No Rust code was copied; no license notice was needed. The `harness_map.json` pattern (static metadata kept separate from live readiness) confirms the gateway rule that launcher state never becomes the capability matrix.

## Compatibility matrix

| OS × workflow | Evidence | State |
|---|---|---|
| Windows × inventory (`installed.json` + `app.ron` + portable + MSI registry) | `inventory.spec.ts` fakes | Implemented, unvalidated against a real install |
| Windows × `serve` `engine.commands` projection (no `command_list`) | `transport.spec.ts` + real-child `serve-handshake.spec.ts` | Implemented, unvalidated against a real install |
| Windows × auto-detect open with observed filter | `discovered.spec.ts` + `tool-craft/tests/discovered.spec.ts` fakes | Implemented, unvalidated against a real install |
| Linux × inventory (XDG launcher manifest + `.desktop` scan) | `inventory.spec.ts` fakes | Implemented, unvalidated against a real install |
| Linux × auto-detect open | `discovered.spec.ts` fakes | Implemented, unvalidated against a real install |
| Real installed ArtCraft suite artifact smoke (OWN-03) | Blocked on the owner app list | Not claimed; S5-09e stays open |

## Related

- The [Craft bridge pilot Agent Note](2026-10-24-v0.3.4-craft-bridge-pilot.md) owns the lazy gateway, manifest-as-data, and attach hard-gate that this decision extends.

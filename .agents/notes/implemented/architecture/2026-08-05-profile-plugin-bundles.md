# Agent Note: Profile plugin bundles replace the fixed surface overlays

Status: implemented


## Problem

The `gnk` launcher hardcoded its compositions: `base.cordis.yml` + `web.cordis.yml` shipped inside `apps/cli`, three bespoke entry modes (`--config`, `web`, `-p`) each with its own layer stack, and a single global personal overlay (`$GNK_HOME/config.yaml`). There was no way to install an out-of-tree plugin (a TUI, a provider pack) into a shipped surface without editing the repository, and no place where a third-party package could contribute a default composition.

## Decision

Everything becomes a **profile**: a directory `$GNK_HOME/profiles/<name>` with a `package.json` (pnpm-managed out-of-tree plugin `dependencies` plus the profile manifest `gnk.profile` with its ordered `bundles` layer list) and a user `cordis.patch.yml`. A **bundle** is an npm package declaring `"gnk": { "bundle": { "patch": "./cordis.patch.yml" } }`; the two manifest kinds live under distinct `gnk.profile` / `gnk.bundle` keys so a package.json states which role it plays. The tree composes over an empty root by applying each bundle's patch in `gnk.profile.bundles` order, then the user layer and `--patch` overlays — one `applyEntryPatches` call shared by boot and `--dump-config`. App invocation values later moved from launcher-derived patches to startup services in the [app-owned command-line decision](2026-08-06-app-owned-command-line.md).

The default Profile templates use `@greeneek/gnk-base` as the shared core for `web`, `headless`, `sdk`, and `acp`, with one mode bundle above it. The [standalone `sdk-minimal` profile](2026-08-24-standalone-sdk-minimal-profile.md) instead lists one bundle that owns its complete explicit tree. Generic `gnk --profile <name>` hands its remaining arguments to that profile's command-line startup row: Web owns its flag family, headless owns its task positional, and the protocol profiles accept no app options. Patch overlays use launcher-owned `--patch`. `gnk plugin --profile <name> <args...>` is a thin pnpm forwarder that initializes the profile and reconciles `gnk.profile.bundles` with installed bundle declarations; a package without a bundle declaration remains a plain dependency. [Headless as a direct core entry point](2026-08-09-headless-direct-core-entry-point.md) owns the headless composition contract.

Resolution is two-anchored by construction: `gnk.profile.bundles` names resolve from the gnk installation first, then the profile directory — so in-box bundles always come from the same installation as the running `gnk` and pnpm never manages them — while bare plugin names in patch rows resolve through the profile directory's Node parent-walk into the maintained flat fallback `$GNK_HOME/profiles/node_modules` (one symlink per package the installation's app and bundles depend on, healed on every launch).

Two supporting refactors: the webserver's built-in static dist serving became the single-owner **fallback seat** (`registerFallback`/`applyIndexTaps`), with the SPA server extracted to `@greeneek/gnk-host-frontend-static` so the web bundle owns its dist as composition, not launcher code; and the personal-overlay machinery of the [gnk CLI personal-config decision](../feature/2026-07-20-gnk-cli-personal-config.md) (`loadPersonalPatches`, `$GNK_HOME/config.yaml`) was retargeted to the per-profile and home-level `cordis.patch.yml` layers (`loadOptionalPatches`, `watchUserPatches` taking a filename), superseding that note's entry modes and file location while keeping its Harness-home root, patch semantics, and fail-loud parsing.

## Alternatives considered

- **Dependency-scan plus partial `patchOrder`** (the original sketch): scanning `dependencies` for bundles and ordering unlisted ones alphabetically has two sources of truth and an implicit tie-break; one explicit ordered `gnk.profile.bundles` list is smaller and fully deterministic. A raw `pnpm add` inside the profile installs a library without activating any patch — explicit, no spooky scan.
- **`link:` entries for in-box bundles**: pnpm cannot version, install, or update a `link:` into the installation, it embeds a machine path in a user file, and it breaks when the installation moves. The two-anchor resolution plus healed symlink fallback gives the same guarantee ("bundles come from the installation") without ceremony.
- **A pre-boot `context` module in the bundle manifest** for boot-time values (dist path, flag facts): rejected in favor of pure plugins — the glue is ordinary rows and app-owned startup services, so the composition stays fully dumpable and the manifest stays data-only. The launcher-provided host slots (`ctx.cmdlineArgs`, `ctx.appExit`, and the environment snapshot) are provided in `boot()`'s `prepare` hook, before any config-tree entry mounts.
- **Transitive bundle auto-application**: only direct `gnk.profile.bundles` entries contribute layers; a meta-bundle wanting to re-export another bundle's patch must do so explicitly in its own patch file.

## Consequences

- New composition surfaces (a TUI, provider packs) ship as ordinary npm packages installable per profile, without a repository row for every deployment shape.
- `apps/cli` shrank to argv parsing, profile machinery consumption, and the pnpm forwarder; `AppCLIEntry` and the per-surface boot paths are gone.
- The keyless web e2e scaffold boots the same bundle layers over the same empty-root shape as production, including the profiles module fallback, so composition drift between test and product fails loudly.
- Under the pre-release stance, backends carry no compatibility behavior for old on-disk configuration; `$GNK_HOME/config.yaml` is ignored.

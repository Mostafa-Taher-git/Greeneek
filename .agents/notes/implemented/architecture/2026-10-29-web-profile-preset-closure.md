# Agent Note: The Web profile installs every preset plugin

Status: implemented

## Problem

The shipped Maestro preset appeared on the Agent presets settings roster as a broken card — `row "tool-agent-team" names a plugin that cannot be resolved: @greeneek/gnk-tool-agent-team` — and selecting it could not mount. Selecting the Instructor or Pixels Designer presets failed with `craft-local … cannot get property "craft" without inject`.

Two independent omissions produced one roster-level failure. The Web profile closure is installed from the base and web-app bundle dependencies plus the CLI's production dependencies; `@greeneek/gnk-tool-agent-team` was only a devDependency of `apps/cli`, so the profile never contained the package the Maestro composition mounts. Separately, `craft-local` still ended with `export default apply`, the exact shape [postmortem 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) records: the Loader's `unwrapExports` prefers `.default`, discarding the sibling `inject` export, so the plugin loaded without its declared services.

## Decision

Every package a shipped preset row can start is declared in the Web profile closure, and the closure is tested. `@greeneek/gnk-tool-agent-team` joins the web-app bundle dependencies; a source gate in `apps/cli/tests/preset-plugins.spec.ts` reads every shipped preset composition and rejects a package that is absent from the CLI, base-bundle, or web-app-bundle dependencies (subpath exports resolve to their package).

Function plugins remain namespace plugins. `craft-local` no longer default-exports `apply`, and a real-load-path guard unwraps the module through `Loader.prototype.unwrapExports` and mounts it over fake `craft`/`subprocess` services, so a restored default export fails the suite before the roster can regress.

## Alternatives considered

- **Enable the private Agent Teams profile in the desktop composition.** The service already lives in `gnk-base`; the preset mounts only its model-facing tool. Shipping the tool through `gnk-web-app` keeps the roster working without a second profile layer.
- **Mark Maestro broken/hidden until P2-06 lands.** The composition and tool exist; hiding a shipped mode because a dependency declaration was missing would report a false capability gap.
- **Depend on the package from the presets package.** Discovery resolves rows from the profile install, not the preset package; a preset-local link would mask the closure gap rather than close it.

## Consequences

- Maestro, Instructor, and Pixels Designer mount from the roster in the dev Web profile.
- A future preset row that names an unshipped package fails `apps/cli/tests/preset-plugins.spec.ts` before the card can appear broken.
- Removing `export default apply` changes direct default imports of `craft-local`; no in-repo caller used one. The Loader now sees `name`/`inject`/`Config`/`apply` as the module namespace.
- The dev profile's pinned `node_modules` predates the dependency addition; a development host that already booted the old closure needs the package linked (or a fresh profile install) once. Packaged installs materialize it from the bundle.

## Verification

- `apps/cli/tests/preset-plugins.spec.ts` is red before the dependency declaration (it names `maestro: @greeneek/gnk-tool-agent-team`) and green after.
- `craft-local` 115 tests green, including the unwrap-and-mount guard; all six modes switch in the rebuilt app with no alert.
- The settings roster shows no broken card, and the Maestro mode selects successfully.

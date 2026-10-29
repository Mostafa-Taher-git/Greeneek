# Agent Note: Fleet favorites and honest provider availability

Status: implemented

## Problem

The model could create a fleet from a single request, and Settings had no way to save a named fleet, inspect which providers could actually run, or reuse a fleet deliberately. A provider documented by a third-party CLI could look available even when this deployment never registered it, and a favorite could silently switch to a different provider when its own provider was missing.

## Decision

Named fleets live in a `fleet` settings namespace registered by the Team service when a settings provider exists. A favorite carries a stable lower-kebab id, a display name, and members with name, description, prompt, provider, context, preset, model, reasoning effort, read-only flag, write scopes, and token ceiling. Schemastery validates the section shape; a cross-field validator rejects duplicate favorite ids, duplicate member names, empty required fields, non-positive budgets, and contradictory lane policy before a write commits. The settings owner fences writes by revision, so the editor's displayed revision is the compare-and-set value.

Availability is derived from this deployment's own composition, never from documentation or a paid probe. The configured fleet providers and registered subagent providers are unioned and reported as `ready` only when the provider can hold a durable Team lane (`prepareContinuable` exists). A registered provider without that method is `unsupported-version`; a configured provider that is not registered is `not-installed`. External CLI providers that this release cannot exercise stay out: they never become ready merely by being documented, and generic ACP is out of scope. The page displays `not-installed`, `unauthenticated`, `unsupported-version`, `ready`, and `temporarily-unavailable`; the current in-process set never reports the unauthenticated or temporary states, so their absence is honest rather than hidden.

Saving a favorite is available from the Web Fleet settings page. Launching requires a current session and an inline confirmation card that echoes every member's provider, context, preset, model, effort, token budget, and write capability. The Host launch revalidates every provider before creating the first child, refuses a missing provider with `TEAM_FLEET_PROVIDER_UNAVAILABLE`, and never substitutes another provider. A false confirmation flag launches nothing. Natural-language fleet requests still flow through the model's structured `spawn_fleet` proposal and its approval composer card; both paths require an explicit confirmation before spend.

## Alternatives considered

- **Probe each CLI with `--version` and an auth command.** That invents readiness from output the deployment cannot map to its own provider registry, and a paid or state-changing command is never acceptable for a status read.
- **Store favorites in the Lead session log.** Favorites are user preferences shared across sessions, not Team conversation events; the settings document is their durable owner and revision fence.
- **Fall back to the default `spawn` provider when a favorite's provider is missing.** That silently changes the fleet the user saved; refusing is the only honest outcome.
- **Launch from the settings page without a confirmation step.** The page is a spend surface; a per-launch card keeps the echoed member set in front of the user even for a saved favorite.
- **Expose a separate natural-language parser.** The model already turns the request into the structured `spawn_fleet` proposal, and one approval card serves both paths.

## Consequences

- A user can save, edit, delete, and launch named fleets from Settings; favorites survive restarts through the settings document.
- A provider that cannot hold a durable lane is visible but disabled, and a favorite naming it is refused rather than redirected.
- The Fleet page is locale-owned (zh/en/ar), uses logical CSS, and loads availability lazily without a paid probe.
- The settings page requires a current session for launch; without one the Launch button is disabled with a reason.

## Verification

- Host tests cover provider-state transitions, favorite validation errors, duplicate ids, revision conflicts, unavailable-provider refusal, confirmation refusal, settings-absence, and a real favorite launch.
- Client tests cover the Fleet page in English and Arabic RTL, availability and failure states, favorite create/edit/delete, optional-field clearing, member add/remove, every launch outcome, and the confirmation card's member echo; the ui-agent-team package reports 100% statement, branch, function, and line coverage on the changed section and mount.
- Typecheck, documentation gates, the logical-CSS gate, and the client i18n gate run with the slice.

# Agent Note: PTC pill removed from the new-session row

Status: implemented


## Problem

The new-session row offered three shipped pills — Standard, PTC, and Creator — while PTC differs from Standard only in how the same tools reach the model: one `run_code` tool plus a generated TypeScript SDK instead of native schemas. Presenting it as a peer mode invited a choice most sessions never need, and the three-pill row spent composer space on a presentation variant. The PTC capability itself is load-bearing: existing session logs record `agent-preset/selected: ptc`, the replay corpus replays them, `run_code` and `gnk-code-runtime` are shipped, and the `GNK_TOOLS_MODE=ptc` demo script exercises the same composition.

Removing the preset outright would break every one of those recorded sessions. The change therefore had to separate *the row's presentation* from *the preset's availability*.

## Decision

`MODE_ORDER` in `packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx` is `['standard', 'cordis']`, and a `HIDDEN_FROM_ROW` set keeps `ptc` out of the trailing authored-preset section as well. Membership in `MODE_ORDER` only assigns the shipped positions; every other healthy roster row is appended after the placeholders, so dropping `ptc` from the order alone would have re-added it as an "authored" pill at the end. The row now renders Standard, Creator, the two "Coming soon." placeholders, then user-authored presets.

Everything else about PTC is deliberately untouched:

- `packages/preset/agent-presets/presets/ptc/` still ships, still mounts, and remains in `BUILT_IN_PRESET_KEYS` in `display.ts` with its locale copy.
- `ToolPresentationMode = 'native' | 'ptc' | 'both'`, the `run_code` composition, and `gnk-code-runtime` remain as they were.
- The `GNK_TOOLS_MODE=ptc` demo script and the `test:snapshot` replay fixtures are unchanged, so a session recorded under PTC resolves its preset and replays its composition exactly as before.
- Settings and custom presets reach `ptc`: the management section lists it, and a copy of it is a normal custom preset. The hero row simply no longer advertises it.

## Stale-default fallback

`AgentPresets.resolve()` now treats an unnamed request differently from an explicit one. An unnamed request is the default pick for a session about to be created, and its id comes from `agent-presets.default` or the composition's own `default` — either can outlive the preset it names (deleted preset, renamed directory, a settings document copied from another deployment). When that id resolves to nothing, resolution composes `'standard'` and logs a warning naming the stale id, the available ids, and the substitution. If the roster has no `standard` either, the original `agent-preset/not-found` is raised; a roster with nothing in it behaves exactly as before.

An explicit id — a per-session mount, `select`, `read`, `copy`, `delete` — still fails with `agent-preset/not-found`. Silently composing a different preset there would misreport which composition the caller's session ran.

`defaultId` keeps reporting the configured value verbatim rather than the substituted one: it answers "what is configured", while `resolve()` answers "what will this new session compose".

## Alternatives considered

**Merge PTC into the Standard composition and delete the preset.** Rejected in the v0.3.4 plan reviews. It breaks the replay corpus, deletes a working capability to remove a pill, and forces a migration with no user-visible gain.

**Keep three pills and only change their order.** Rejected because the pill is the decision under review; the row's job is to offer the modes most sessions start from.

**Throw `agent-preset/not-found` for a stale default and let session creation fail.** Rejected because a setting a user cannot see from the new-session screen would brick every new session. The failure mode is a stale pointer, not a user request for a missing composition.

**Silently fall back to `standard`.** Rejected on the repository's fail-loud stance: a deployment that silently stopped honouring its configured default would hide a real configuration drift.

**Remove PTC from the roster and display mapping as well.** Rejected because recorded sessions and the Settings surface both resolve the preset by id; the roster is what keeps the capability reachable after the row stops advertising it.

## Consequences

The hero row is one pill shorter and no longer offers a presentation variant as a mode. PTC remains reachable through Settings and custom presets, so the capability is discoverable later rather than at first run.

A stale default now costs one warning per resolution attempt instead of a failed session; the warning repeats until the setting or the roster is fixed, which is the intended pressure to correct it.

Preset tests pin that `ptc` is still listed by the shipped root and still resolves display copy, while the client suite pins the two-pill row and the absence of a PTC radio. The replay guarantee is structural: no preset file, `run_code` composition, or recorded-session fixture changed in this workstream.

## Related

- [PTC preset omits the general workflow tool](2026-09-01-ptc-omits-workflow-tool.md) — the PTC composition this note keeps available.
- [Per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.md) — the default-preset layering the fallback reads.

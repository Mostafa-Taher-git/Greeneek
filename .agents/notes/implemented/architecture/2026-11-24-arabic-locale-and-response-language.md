# Agent Note: Arabic locale and response language

Status: implemented

## Problem

Selecting Arabic left terminal accessibility labels and Host-reported application names in English, and the selected preference never reached the model, so replies stayed in English. The locale change was only a client event and had no model-visible representation.

## Decision

The six flagged strings now live in the `ui-chat` and `ui-sidebar` dictionaries, with Arabic translations and the sidebar labels resolved at call time through `locale.bind`. The escaped placeholder in the Arabic compaction message is corrected. A new central `RESPONSE_LOCALE` prompt position carries a Host-registered `session:locale` section that reads the durable `locale.preference` setting on every assembly and instructs the model to write user-facing prose in that language while keeping code and paths verbatim. With no preference the section renders empty, so existing prompts stay byte-identical. The instruction enters the model request through `request/header`, which the agent loop already persists, so no new session event or format version is needed. Right-to-left direction continues to come from the locale's primary language subtag.

## Alternatives considered

A durable `user/message` would add a visible transcript row for an instruction the user did not type. Reading the browser event directly would make the prompt depend on client state that the session log cannot reconstruct. Registering a fixed instruction would force a language on sessions with no selected preference.

## Testing

`pnpm run verify-client-ui-i18n` reports 568 locale-owned source files and exits 0; `scripts/locale-dictionary-parity.spec.ts` passes. `packages/client/locale/tests/response-locale.client.spec.ts` pins the assembled Arabic prompt with a keyless inline snapshot, checks RTL direction, and verifies later locale changes. Recorded-session replay is Linux/macOS-only on this fork and was not run on Windows.

## Consequences

Product copy switches with the selected locale and the model receives a reconstructable language instruction. Changing a locale changes the assembled prompt prefix, so the next request starts a new cached prefix.

## Related

[2026-08-23-locale-owned-client-ui-copy.md](2026-08-23-locale-owned-client-ui-copy.md)

# Browser AI connections

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowserai--browserairegistry"></a>

### `ctx.browserAI` — `BrowserAIRegistry`

The Browser AI registry and isolated session manager.

```ts cordis-catalog
/**
 * All registered providers, for a connection list UI.
 * @returns the immutable provider roster.
 */
list(): readonly BrowserAIProvider[]

/**
 * Resolve one provider or fail with a stable code.
 * @param providerId - provider to resolve.
 * @returns the provider descriptor.
 */
get(providerId: string): BrowserAIProvider

/**
 * The isolated browser profile for one provider.
 * @param providerId - provider whose profile to resolve.
 * @returns the provider-isolated profile id.
 */
profile(providerId: string): BrowserProviderProfile

/**
 * Status of one provider session (login-required before first open).
 * @param providerId - provider whose status to report.
 * @returns the credential-free session projection.
 */
status(providerId: string): BrowserAISession

/**
 * Open a provider's official site in its isolated browser profile for manual
 * use. The browser surface becomes visible through the browser/surface event.
 * @param providerId - provider to open.
 * @returns the session snapshot after opening.
 */
async openManual(providerId: string): Promise<BrowserAISession>

/**
 * Read the visible page of a provider session with the untrusted-content
 * boundary applied by the browser tool layer. Never returns cookies/tokens.
 * @param providerId - provider whose session to read.
 * @returns the bounded page content.
 */
async read(providerId: string): Promise<BrowserPageContent>

/**
 * Authorized automation entry point. Refused by name for every provider whose
 * capability matrix marks automation unavailable - never approximated.
 * @param providerId - provider the caller wants to automate.
 * @param agent - exact owning Agent (kept for the future authorized path).
 * @returns never; every path throws with a stable refusal code.
 */
automate(providerId: string, agent: Agent | undefined): never

/**
 * Mark a session as login-required or expired (user/UI action).
 * @param providerId - provider whose session changed.
 * @param status - new lifecycle status.
 * @returns the updated session projection.
 */
setStatus(providerId: string, status: BrowserAISessionStatus): BrowserAISession

/**
 * Clear a provider session's status; browser profile storage is untouched here.
 * @param providerId - provider whose session status to clear.
 * @returns the reset session projection.
 */
clear(providerId: string): BrowserAISession
```

Types: [Agent](core.md) · [BrowserPageContent](browser.md)

Source: [`packages/browser/browser-ai/src/index.ts`](../../packages/browser/browser-ai/src/index.ts)
<!-- END GENERATED cordis-surface -->

Browser AI connections (`ctx.browserAI`) let a user open an official web AI interface inside Greeneek's own browser surface with a manually established session. The `BrowserAIProvider` descriptor declares manual and automation capabilities independently; automation is refused by name wherever the recorded capability matrix marks it unavailable.

## Types

- `BrowserAIProvider` - vendor, official URL, and independent `manual` / `automation` flags with the exact reason and terms source for automation.
- `BrowserAISession` - credential-free projection: provider id, isolated profile, official URL, status, and capabilities. Never contains a password, cookie, or token.
- `BrowserAISessionStatus` - `login-required`, `connected`, `session-expired`, or `unavailable`.
- `BrowserProviderProfile` - the isolated storage profile id (`provider:<id>`).

Greeneek never collects a password and never extracts an authentication cookie or token into application or agent state. Provider sessions are isolated by storage directory; automation of a subscription session is not claimed where the provider's terms do not permit it.

# Browser use

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browsersurfaceservice"></a>

### `ctx.browser` — `BrowserSurfaceService`

The browser-use service: one backend slot plus per-profile tracked state.

```ts cordis-catalog
/**
 * Register the single browser runtime provider. A second registration is
 * rejected, so provider selection never depends on activation order.
 * @param backend - the provider to install.
 * @returns disposer that removes exactly this provider.
 */
registerBackend(backend: BrowserBackend): () => void

/**
 * Current tracked snapshot for one profile.
 * @param profile - profile to read.
 * @returns the tracked snapshot, with status closed when nothing is open.
 */
snapshot(profile: BrowserProfile): BrowserSurfaceSnapshot

/**
 * Open or navigate one profile.
 * @param owner - exact owning Agent, or undefined for a user/UI-driven change.
 * @param request - target profile and validated http(s) address.
 * @param signal - cancellation of the operation.
 * @returns the resulting tracked snapshot.
 */
async open(owner: Agent | undefined, request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserSurfaceSnapshot>

/**
 * Close one profile.
 * @param owner - exact owning Agent, or undefined for a user/UI-driven change.
 * @param request - target profile.
 * @returns the resulting tracked snapshot.
 */
async close(owner: Agent | undefined, request: BrowserCloseRequest): Promise<BrowserSurfaceSnapshot>

/**
 * Read bounded content from a real page. A provider without content support
 * is refused by name rather than approximating page access.
 * @param owner - exact owning Agent, or undefined for a user/UI-driven read.
 * @param request - profile and optional URL to navigate before reading.
 * @param signal - cancellation of the operation.
 * @returns the bounded page content (untrusted page data).
 */
async read( owner: Agent | undefined, request: { profile: BrowserProfile; url?: string }, signal?: AbortSignal, ): Promise<BrowserPageContent>

/**
 * Activate one visible link and read the resulting page.
 * @param owner - exact owning Agent, or undefined for a user/UI-driven action.
 * @param request - profile, optional URL, and the link selector.
 * @param signal - cancellation of the operation.
 * @returns the bounded resulting page content.
 */
async click( owner: Agent | undefined, request: { profile: BrowserProfile; url?: string; selector: BrowserLinkSelector }, signal?: AbortSignal, ): Promise<BrowserPageContent>
```

Types: [Agent](core.md)

Source: [`packages/browser/browser-use/src/index.ts`](../../packages/browser/browser-use/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browsersurface--emit"></a>

#### `browser/surface` — emit

A browser profile's tracked navigation state changed.

```ts cordis-catalog
/**
 * A browser profile's tracked navigation state changed.
 * @mode emit
 * @param snapshot - the updated surface state.
 */
'browser/surface'(snapshot: { profile: string url: string | undefined status: 'open' | 'closed' titleSource: 'reported' | 'unknown' source: 'agent' | 'user' }): void
```

Source: [`packages/api/session-controller/src/types.ts`](../../packages/api/session-controller/src/types.ts)
<!-- END GENERATED cordis-surface -->

The browser-use capability seam (`ctx.browser`) holds one registered runtime provider and one tracked navigation state per browser profile (`default` and `incognito`). Agent tools and the visible right-panel browser surface share this single authority: an agent navigation becomes visible to the user through the forwarded `browser/surface` event, and user navigation is observed by agents via `browser_snapshot`.

## Types

- `BrowserBackend` - the single replaceable runtime slot. The default provider records surface state; it owns no browser process.
- `BrowserProfile` - `default` or `incognito`.
- `BrowserSurfaceSnapshot` - bounded tracked view: profile, URL, status, title source, and who last drove the surface.
- `BrowserNavigateRequest` / `BrowserCloseRequest` - profile-addressed verbs.

`browser_snapshot` reports tracked navigation state only. The Web carrier is a cross-origin sandboxed iframe and many sites refuse embedding, so page contents, DOM, and cookies are not available to agents. Browser-originated data is untrusted and must never be treated as instructions.

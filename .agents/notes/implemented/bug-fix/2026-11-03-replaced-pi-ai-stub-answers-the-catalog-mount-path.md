# Agent Note: The replaced pi-ai stub answers the mount-time factories the curated catalog calls

Status: implemented

## Problem

The web-worker preview serves `@earendil-works/pi-ai` from the worker bundle ([the replaced externals registry](../../../../packages/experimental/webworker-runtime/src/node/external_packages/replaced-externals.ts) and the stub in its [pi-ai module](../../../../packages/experimental/webworker-runtime/src/node/external_packages/pi-ai.ts)), because the package is Node-only and its transports cannot run behind a browser worker. The stub predates the curated `kilo` route: `harnessCatalogProviders()` now constructs pi-ai objects while the row enumerates its catalog — `createProvider(...)`, `envApiKeyAuth(...)`, and `openAICompletionsApi()` are all on the mount path — and the stub refused every call. The tree load died with `envApiKeyAuth is not a function` on the runner and no preview deployment booted (the empty selection and the fixture overlay both require the same plugin tree), which is also what [the string_decoder table entry](../architecture/2026-11-03-worker-builtin-table-holds-every-requested-builtin.md) unmasked: its fix moved the lane's failure past the pack stage to the plugin-tree apply.

## Decision

The stub keeps its standing contract — every symbol `llm-pi-ai` imports by name is present, and everything on a request path is loud — with the mount-time factories added to the answering side. `createProvider` returns the descriptor fields callers read (`id`, `auth`, `models`, `baseUrl`) plus a real `getModels()` and loud `stream`/`streamSimple`; `envApiKeyAuth` returns the route's auth marker with an unconfigured `resolve` (it reads no environment and no credential store) and a loud `login`; the three lazy protocol factories return inert implementation objects whose every member access refuses while naming the module and property. The request-path members (`createModels`, `getSupportedThinkingLevels`, `isContextOverflow`) keep the plain refusal as before, and `node-stubs.spec.ts` pins both sides per member.

The same pass repaired two lane-side facts around the mount, each verified against the product rather than absorbed:

- The scenario's static server passed the URL pathname through `path.normalize`, so on Windows every Linux-style asset path came back with a backslash prefix and the self-packed image 404ed before the worker ever reached the stub. The server now reads the pathname's segments directly and answers 404 for a `..` segment.
- The empty preview serves no llm adapters, so the model directory raises its block and the hero settles with `data-placeholder` carrying the block reason instead of the hero prompt (`ConversationRoot` passes the raised reason as the placeholder). The scenario waits for that control and comments the source, so the placeholder can no longer be mistaken for a stall.

## Alternatives considered

**Why not bundle the real pi-ai into the image?** That un-replaces the package only in name: its transports need Node sockets, child processes, and five cloud SDK adapters, and a bundle that half-activates converts the stub's named refusals into undefined, unspecified failures — worse than the substitute.

**Why not return the curated catalog empty in the worker?** It would recover the green lane without adding stub surface, but it requires `llm-pi-ai` to learn it is stubbed — a dependency running backward into the row that replaced it — and it hides a catalog the Models page offers in every other deployment for no reason the environment can name.

**Why not hand-write an Api object shape for the protocol factories?** The request surface pi-ai's compat layer reads from an implementation object is unspecified from this side, so a named member set would be a guess in both directions. An inert object that refuses while naming itself keeps the truth (`no transport here`) without claiming any field.

## Consequences

- The stub contract for replaced externals now has three tiers — present, structurally answered, loudly refused — and the mount-path factories must move down a tier whenever llm-pi-ai's enumeration path gains a call; `node-stubs.spec.ts` is the table for the members themselves.
- The empty preview's blocked composer is pinned behavior: the lane asserts the blocked placeholder, so a change to that block or its copy fails the lane with a named source instead of unread drift.
- The static server's traversal guard is segment-based, not separator-normalizing; a future test asset scheme that needs `..` normalization must route through the same guard rather than reintroducing host-form paths.

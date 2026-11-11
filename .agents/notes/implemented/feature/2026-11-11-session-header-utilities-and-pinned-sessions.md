# Agent Note: Session header utilities, pinned Sessions, and the Host open-in picker

Status: implemented

## Problem

The conversation header offered the Session title and the sidebar listed Sessions, but the product had no way to open a Session's directory on the desktop, no way to keep a Session in view, and no place to reach the per-Session verbs (rename, fork, archive, delete, copy id). The DeepSeek harness reference surface the owner asked for groups those verbs in the Session header and opens the workspace folder from the same place.

Opening a path needs Host facts the browser cannot know: which applications are installed, which platform the Host runs on, and whether a file manager exists. The Session also needs a durable "pinned" state that survives a restart and survives grouping, so a pinned Session stays visible while its Workspace group is folded.

## Decision

Add three pieces that meet at the Session header:

- **Host open-in capability.** `packages/util/native-command/src/external-app.ts` owns the external application catalogue (`EXTERNAL_APPS`), per-call availability probing (`externalAppAvailability`), launching without a shell (`launchExternalApp`), and file-manager reveal (`revealNativePath`, `canRevealNativePath`). Every command is spawned with an argv and the path is one argument; no shell is involved. Path spelling follows the *requested* platform, not the host, so the adapter can answer for another platform.
- **Host read-only git facts.** `packages/util/native-command/src/git-facts.ts` reports whether a project directory is inside a git work tree, the checked-out branch, the base branch the change set is compared against, and the size of that change set. Every command is read-only and runs through git's own `-C` flag, so no shell is involved and the working directory never changes.
- **Host remotes.** `SessionController` gained `externalApps()` (catalogue, platform, reveal capability), `openPath({ path, target })` where the target is `default`, `reveal`, or `app`, and `gitFacts({ path })`. All three are `@Remote` methods, so the browser calls them through the generated namespace. `openPath` refuses an empty path, an unavailable reveal target, an uninstalled application, and an unknown target kind, and it distinguishes a cancelled request from a failed one.
- **Registry-global pin set.** The Workspace domain state carries `pinnedSessionIds` beside `archivedSessionIds`. A pinned Session keeps its accounting slot and its position; only the grouping surfaces read the set. The field is defaulted, so media written before it existed parses unchanged and the unit format version does not move (the single-unit JSON backend rejects a stamp it does not accept, and a defaulted field is not a format change). `WorkspaceController.pinSession` is idempotent, `WorkspaceFeed` publishes a `pinned` increment, and the Client model installs the confirmed set.

In the browser, `packages/client/ui-workspace/src/client/SessionHeaderUtilities.tsx` renders the header cluster: a split "open in" button (folder = default application, chevron = the catalogue), a pin toggle, an archive button, an overflow menu (pin, rename, fork, copy id, show in folder, archive, delete), and the right-sidebar toggle. The sidebar row menu gained the same pin verb, a copy-id verb, and a show-in-folder verb, and the Workspace row gained an **Open in…** submenu for the Workspace directory. Both surfaces build their destinations from one shared module (`openInMenu.tsx`), so the header and the row offer the same applications and the same target vocabulary. A pinned row shows a pin marker and stays visible inside a folded Workspace group.

Shortcuts use the shared `mod+` spelling (`mod+alt+g` rename, `mod+alt+f` fork, `mod+shift+a` archive), so the command key follows the platform. The shortcut matcher in `packages/client/ui-primitives/src/shortcuts.ts` was corrected: `mod` and `ctrl` are the same physical key outside macOS, and the previous equality check made every `mod` specification unmatchable.

## Consequences

- The `HostPlatform` union in `packages/api/session-controller/src/types.ts` replaces `NodeJS.Platform` on the wire types, because browser programs have no Node type definitions.
- `packages/client/ui-primitives/src/Menu.tsx` renders a trailing shortcut hint as decorative content (`aria-hidden`), so a menu row's accessible name stays its label.
- The external application catalogue is a fixed product list (`cursor`, `vscode`, `android-studio`, `github-desktop`). The Client names those four; an application the Client has no name for is not offered, and the Host never invents entries.
- The header utilities read the catalogue on mount. A failed read leaves the system file-manager entry alone and logs a warning; the header never blocks the conversation on it.
- The header cluster owns one place per verb: the pin and archive buttons are always visible, the open-in split carries the file-manager entry, and the overflow menu holds only the verbs with no visible button (rename, fork, copy id, delete). The sidebar row menu keeps its own full set, because it is a different surface.
- The project's git facts are read only when the project's menu opens, and only for a project the user opened.

## Live verification (2026-11-11)

Three defects surfaced only when the desktop app was actually opened and driven:

- **The client could not reach the Host at all.** `packages/client/ui-workspace/src/client/index.ts` declared `remote` but not `remote.session` in its `inject` list, so `ctx.remote.session.externalApps()` threw `cannot get property "remote.session" without inject`. Every open-in read failed, and the catalogue stayed empty. The inject list now names `remote.session`, and the affected specs provide that namespace.
- **The desktop app ran a stale CLI.** `apps/desktop` resolves the CLI through pnpm's injected workspace copy, which is a snapshot from install time; a development launch therefore served code from before the change. `resolveGnkEntry` now prefers the workspace build (`<repo>/apps/cli/lib/bin.js`) when a checkout is beside the app, and falls back to the staged CLI in a package.
- **The new remote was missing from the served bundle.** `packages/api/remotes` inlines every package's generated remote contribution, so a new `@Remote` method needs that bundle rebuilt before the browser can call it.

## Missing on purpose

The reference project menu also carries **Commit & push**, **Add project script**, and a branch picker. None of them is built here: committing and pushing write to the user's repository, and a project script needs a concept the product does not have yet. The read-only git facts (branch, base branch, change size) are the part that can be honest without inventing a write path.

## Alternatives considered

- **Let the browser ask the Host to run a shell command** - a shell string is the injection surface the repository already forbids; rejected in favor of argv spawning.
- **Store the pin set in the Session log** - a display preference would become a durable model-visible event; rejected in favor of the registry-global Workspace state that already owns the archive set.
- **Give every catalogue entry a Client-side fallback list** - a missing application would be offered and then fail at launch; rejected in favor of probing per call.
- **Render the open-in catalogue from a static Client list** - the Client cannot know what is installed; rejected.

## Verification

- `packages/util/native-command/tests/external-app.spec.ts` (32 cases): catalogue probing per platform, launch, reveal, and refusal paths; per-file coverage of `external-app.ts` is 100%.
- `packages/api/session-controller/tests/session-open-path.host.spec.ts` (10 cases): the two new remotes through the generated unary semantics, including the refusal and cancellation codes.
- `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts`: pin command, `pinned` increment, and the baseline that now carries the pin set.
- `packages/workspace/workspace/tests/workspace.spec.ts`: the durable pin set, its idempotence, the delete interaction, and the version-2 media upgrade.
- `packages/client/ui-workspace/tests/session-header-utilities.client.spec.tsx` (49 cases) and `tests/tree.client.spec.ts`: the header cluster, the catalogue filtering, the shortcut behavior, the pin marker, and the folded-group visibility; per-file coverage of `SessionHeaderUtilities.tsx` is 100%.
- `packages/client/ui-primitives/tests/shortcuts.client.spec.ts` (26 cases): the corrected matcher and display; per-file coverage of `shortcuts.ts` is 100%.

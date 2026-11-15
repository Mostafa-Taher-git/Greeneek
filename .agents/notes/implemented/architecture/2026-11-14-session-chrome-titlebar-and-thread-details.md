# Agent Note: Session chrome — the titlebar and the Thread Details panel replace the session header

Status: implemented

## Problem

The conversation column carried a second header bar — breadcrumb title, view menu, action row, utilities — under the window chrome. The owner's T3 reference puts the Session's chrome in exactly two places: the window chrome (brand, session title, the three panel toggles) and the Thread Details column (the Session's own verbs and facts). In Greeneek the duplication was mechanical as well as visual: each of the three header slots had one occupant, the header entry shared a store with the session body, and the per-Session verbs lived in both the header row and the sidebar row.

## Decision

The session header is gone; the conversation column is the titlebar row, the scrollport, and the composer. Session identity lives in the titlebar, Session verbs and facts live in the Thread Details panel, and the slot contract mirrors that split:

- `conversation.session.header`, `.header.actions`, `.header.lineage`, and `.header.utilities` are removed, together with ui-conversation's `ConversationSessionHeader`. The conversation registration owns `conversation.session` alone.
- The details column's contract is `conversation.details.thread` (single, session) — the whole card — with `conversation.details.thread.action` (list; renamed from `conversation.details.actions`) and `conversation.details.thread.lineage` (single) as its children.
- The `conversation.details.thread` SlotMap member lives in ui-workspace's contract, because that package owns the card component and its props (`ThreadDetailsPanel`, `ThreadDetailsPanelInjected`). ui-chat's `details` entry declares the hole and renders the card through its `DetailsPanel`; ui-chat keeps a type-only ui-workspace edge to see the member. The reverse edge would close the compile cycle ui-workspace → tool-owned-render → ui-chat.
- ui-sidebar registers the `titlebar` entry that ui-layout's AppFrame renders on every host: the brand, the session title (a button that returns to the Session's Chat view through `ctx.layout.showConversation()` then `ctx.uiConversation.selectView(sessionId, 'chat')`), and the three panel toggles (thread details, terminal drawer, right panel) driving the layout's `SessionPanelControls`. The desktop host marks `documentElement[data-desktop-titlebar]`, reserves inline-end space for the injected window controls, and toggles maximize through the preload bridge on double-click; the web host renders the same row without those desktop affordances.
- ui-workspace's card (`ThreadDetailsPanel`) carries the workspace row with the shared open-in split, the action row (`conversation.details.thread.action` registrants: agent-preset label, Team, background jobs, Schedule catalog, Trajectory, transcript export), the pin and archive buttons with the overflow menu, the read-only git facts section, and the Lineage section. The lineage section follows a `HostObservable<boolean>` occupancy hook over `conversation.details.thread.lineage`, so the section exists exactly while a lineage occupant does.
- ui-subagent's lineage renderer is `ThreadDetailsLineage` (renamed from `SubagentHeaderLineage`) registering into `.thread.lineage`; ui-workspace owns its owner share `ThreadDetailsLineageOwnerProps { lineageSessionId, displayTitle }`.

## Alternatives considered

- **Keep the header and move only the toggles.** Partial T3 parity would have left three near-empty header slots, the store share, and verbs in two menus; rejected in favor of removing the duplicated surface outright.
- **ui-chat owning the `conversation.details.thread` SlotMap member.** The member would sit beside the hole declaration, but ui-workspace's contract would then need a ui-chat type edge, closing the cycle ui-workspace → tool-owned-render → ui-chat; rejected — the owner of the component owns the member, and ui-chat's existing type-only edge reads it.
- **A dedicated ui-thread-details package.** The card shares ui-workspace's locale namespace, session verbs, open-in machinery, and pin/archive/delete plumbing; a package boundary would either duplicate those or widen ui-workspace's exports for a single consumer; rejected.

## Consequences

- The details column keeps the tool inspector (`conversation.details.tool`) beside the card; the layout store, panel preferences, and keyboard bindings (`mod+shift+b` / `mod+j` / `mod+alt+b`) are unchanged.
- The session body is the only conversation entry sharing the chat store with the composer; view selection routes through the body's registered selector (`ctx.uiConversation.selectView`), which is what the titlebar's return affordance drives.
- The card's action row and the sidebar row mean the same verbs through one shared implementation (`sharedSessionInjected` in ui-workspace), so a verb never means two things.
- The open-in cluster, pin set, and git facts that [the session-header-utilities note](../feature/2026-11-11-session-header-utilities-and-pinned-sessions.md) placed on the session header now render in this card.
- The removed header controls move, not vanish: `More session actions`, pin, and archive live in the card, which the layout hides (`hidden` on the closed details column), so assembled-output scenarios must open the details panel before driving them. The panel preference persists per browser context and every session switch closes the column, so `openThreadDetails` in `apps/web/tests/support.ts` reads the toggle's pressed state instead of blind-clicking, and card-only lineage interactions go through it (`openLineage` in the subagent scenarios). The one return control is the titlebar's session-title button (`Return to chat: <title>`), which is idempotent on the Chat view, so the shared `showChat` helper clicks it unconditionally.
- The details column inherits the pre-existing `detailsSession` gate (current Session with `blank === false`), so a toggle click on a blank current Session flips the pressed state without widening the column. The client's list blank bit lowers only on a locally accepted prompt, a list upsert, or a reconnect pull; content that materializes purely host-side leaves the bit stale until the next pull, so `agent-team-panel.e2e.ts` reloads after its host-side appends (the route `subagent-interrupt-ui.e2e.ts` already used) before opening the card.
- The Schedule reminder trigger and the background-job trigger are card actions (`conversation.details.thread.action`), so scenario steps that switch Sessions (`schedule-after.e2e.ts`) reopen the card before waiting for the trigger to be visible.
- Browser-visible conversation-column output changed wholesale, so the assembled-output lane covers the restructure.

## Verification

- Package suites: ui-workspace 264 (the panel spec is 53 cases and the apply spec carries the `conversation.details.thread` registration case), ui-chat 320, ui-conversation 360, ui-sidebar 49, ui-tool 303, ui-subagent 33, and the jobs/schedule/team/preset/trajectory/export group 445.
- The ui-theme stylesheet gates cover the new sheets: the details column rebinds the scrollbar pair on the elevated card and the card's hairline divider draws at 0.5px.
- `npx tsc -b tsconfig.client.json` compiles clean with the slot renames.
- Regenerated artifacts: `slot-catalog.ts` (`pnpm run gen-client-catalog`) and the five `etc/*.api.md` reports (`pnpm run gen-api-reports`).
- The browser replay lane (`GNK_SNAPSHOT=replay pnpm run test:web`) covers the assembled conversation column. This stretch cannot run that lane on Windows: the shipped base composition is platform-conditional (`tool-bash` disabled and `tool-pwsh` enabled on win32), six replay fixtures drive `bash` calls the Windows composition cannot execute, and the lane's goldens predate the restructure. The lane evidence for the restructured chrome is therefore the ubuntu `recore-web-goldens.yml` dispatch — refresh mode, whose artifact patch is reviewed and committed after the source change — followed by the read-only replay run on CI.

# Agent Note: Compose subagent children on lane presets

Status: implemented


## Problem

Maestro's orchestration value depends on members that are not clones of the leader: a documentation lane needs the instructor composition, a review lane the reviewer composition, and a code lane the standard one, all inside one parent session. Today a child inherits its parent's composition. `applyChildComposition` joins the parent's live scope chain, and the tool-filter and persona options narrow that inherited composition rather than replacing it, so a lane expressed as a restriction still carries the parent's tools, prompt sections, and plugins.

The alternative the plan rejected is passing composition options that the runtime cannot honor. `SubagentCapabilities` flags exist precisely so an unsupported request is rejected before delegation instead of accepted and ignored, and the in-process child is composed inside the Agent factory's unpublished creation window, where a late `bindScopeParent` on an already-bound scope key would leave a half-composed session. So the field could not be added until the resolution ORDER was proven: the target preset must resolve and mount before the child's context publishes.

## Decision

`SubagentStartRequest.agentPreset` names an agent-preset id the child composes from, gated by the new `SubagentCapabilities.agentPreset` flag and carried through `ChildComposition.agentPreset`. The in-process providers advertise the flag; `NO_START_CAPABILITIES`, ACP, Codex, Claude Code, and the GNK SDK backend do not, so `SubagentRuntime.start()` rejects a lane request with `UNSUPPORTED_CAPABILITY` before any provider runs.

`applyChildComposition` became async because mounting resolves a roster entry and awaits its standing composition. The Agent factory already awaits `AgentSetup` before it inserts or announces the session and agent, so the lane joins inside the same creation window the persona and tool filter use, and the ordering is unchanged: the preset join installs first, then the child's own scoped registrations, so the nearest scope still wins a name and a per-child filter intersects the lane's admitted tools. A rejection now rolls the creation back — the test asserts no child Agent, an unchanged parent composition, and the `agent-preset/not-found` diagnostic naming the requested id.

The child's durable header records the lane id. `childSessionMeta` takes the requested id and falls back to the parent's composed preset only when none was asked for, which keeps a cold transcript read resolving presenters against the composition the child actually ran under.

Continuable children refuse the field, in `startContinuable` before any child id is reserved. Their cold resume rebuilds composition from the version-pinned `subagent/descriptor` event, which snapshots persona and tool filter only. Adding the lane id there is a deliberate `SUBAGENT_DESCRIPTOR_VERSION` change, and 25 recorded SDK and session scenarios embed version 3 descriptors today, so the bump requires re-recording those fixtures. Silently accepting a lane that a resume cannot reproduce would make a child's identity depend on whether its Activation happened to be resident, which is the failure mode the descriptor versioning exists to prevent.

## Alternatives considered

**Express a lane as a tool filter plus persona over the parent's composition.** Rejected: it cannot ADD a capability the parent lacks, so a docs lane still carries the parent's execution tools and prompt sections, and the model-visible request stays the parent's shape.

**Create the child on the deployment default and recompose it to the lane afterwards.** Rejected: the recompose path re-links a published agent's scope ancestry, so a lane applied after publication would emit `session/created` and `agent/session-start` under the wrong tool set before correcting them.

**Accept the lane field for continuable children and restore it from the child header on resume.** Rejected for now: the header preset names a preset id, not the generation the child ran on, so an edited composition file would silently move a resumed lane to a newer generation than its own history — the exact drift the live-parent join avoids for inherited children.

## Consequences

- `SubagentCapabilities` gained a required member, so every provider literal in the repository and in the tests that pin capability objects names it. `subagent-gnk-sdk` advertises `agentPreset: false`; its HMR test asserts the full object.
- Maestro lanes dispatch through one-shot starts until the descriptor version step lands. A team member that must accept follow-up turns still inherits its parent's composition, and `startContinuable` says so rather than half-honoring the request.
- `gen-cordis-api` regenerated the published declaration for `SubagentCapabilities` and `SubagentStartRequest`, and `docs/subsystems/subagent.md` mirrors both with the lane rationale inline.
- The lane join is one `bindScopeParent` per child, never two: requesting a lane replaces the parent join instead of following it, so the double-bind hazard that would have thrown `scope key is already bound to a parent` cannot be reached from the request path.

## Testing

`packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts` asserts the model-visible outcome rather than the call: a lane child's request carries the lane preset's tool, its header names the lane, and the parent keeps its own tool; an unknown lane id rejects, publishes no child, and leaves the parent composition intact. `packages/subagent/subagent/tests/service.spec.ts` covers the capability rejection through its existing table, and `continuation.spec.ts` covers the continuable refusal before an id is reserved.

Evidence: `pnpm exec vitest run packages/subagent packages/workflow/tool-workflow packages/workflow/workflow-worker-thread packages/workflow/tool-ralph packages/sdk/server` → 54 files, 1144 tests pass, 2 skipped. `pnpm run typecheck` clean. One `agent-team/tests/team.spec.ts` cold-resume test failed once in a 56-file run, passed alone (48 tests) and again in the identical rerun, so it is recorded as load-sensitive rather than fixed here.

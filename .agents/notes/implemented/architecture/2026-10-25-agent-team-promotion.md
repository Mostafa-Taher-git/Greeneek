# Agent Note: Promote the Agent Teams family to its product-role groups

Status: implemented


## Problem

The v0.3.4 plan assigns Maestro, the durable multi-lane orchestration mode, to the Agent Teams packages: their roster, durable mailbox, and compare-and-swap task board are the pieces a lane needs, and Army uses the separate wave engine instead. [Incubating the family as private experimental packages](2026-08-18-experimental-agent-teams-packages.md) made that assignment impossible to ship: `packages/experimental/**` is excluded from the gnk release family, release packages and apps may not depend on it, and its `@greeneek/gnk-experimental-*` names carry no stability promise. Keeping the family there while Maestro becomes a selectable mode would ship a product surface whose runtime is unpublished and unreachable from the released composition.

Experimental [subtree rules](../../../../packages/experimental/AGENTS.md) require a promotion to move each package to its product-role group, drop the `experimental-` npm prefix, and update every import and configuration row atomically, then review the public contract, limitations, test evidence, release payload, runtime dependents, and named stable owner. A rename that leaves the directories in place, or a move that leaves catalogs, tsconfig rows, or profile layers naming the old paths, fails the workspace, doc-sync, and runtime-closure gates that read those rows.

## Decision

The five packages left `packages/experimental/` together in one commit, each to the group that owns its role:

| Former package | Group and directory | npm name |
|---|---|---|
| `experimental/agent-team` | `packages/subagent/agent-team` | `@greeneek/gnk-agent-team` |
| `experimental/tool-agent-team` | `packages/subagent/tool-agent-team` | `@greeneek/gnk-tool-agent-team` |
| `experimental/client-ui-agent-team` | `packages/client/ui-agent-team` | `@greeneek/gnk-client-ui-agent-team` |
| `experimental/agent-team-profile` | `packages/bundle/agent-team-profile` | `@greeneek/gnk-agent-team-profile` |
| `experimental/agent-team-web-profile` | `packages/bundle/agent-team-web-profile` | `@greeneek/gnk-agent-team-web-profile` |

Each manifest now sets `publishConfig.access` to `public` and omits `private`, which is the declaration [workspace constraints](../../../../scripts/check-workspace-constraints.ts) require of a release member, and its `repository.directory` names the new path. The `ctx.agentTeams` domain joins the subagent group beside the delegation providers and the wave engine, the Team tools join it beside `tool-wave`, the browser plugin joins the other `ui-*` features, and the two patch layers join the group that owns `gnk --profile` carriers.

Promotion changes publication, placement, and naming only. Composition behavior is unchanged: no shipped default profile applies either layer, the Host profile still disables the global continuable-child controls whose model-visible names overlap the Team tools, and the Web layer still mounts only beside the Host layer. The two profile specs now assert the release-member declaration instead of the private one, which is the behavior that actually changed; every other assertion, including the patch rows and their order, is untouched.

The family keeps the review the promotion required. Its public contract, invariant companion, lifecycle and persistence tests, real-composition profile tests, built-artifact smoke, Model Experience sections, and Known Limitations entries all moved with it, and the generated plugin, config, tool, client, Cordis, persistence, module-graph, and service-role catalogs were regenerated rather than edited. `packages/experimental/README.md` now links no subsystem page, so `scripts/verify-subsystem-pages.ts` carries an explicit exemption for that group: unreleased prototypes keep their contracts in each package README until promotion assigns a product-role owner.

The stable owner is the Maestro workstream in `docs/plan-v0.3.4.md` §8, whose G1 milestone builds lanes on this family.

## Alternatives considered

**Promote only the domain, tools, and browser packages and delete the two profile layers.** Rejected: the layers carry the composition decision that resolves the model-visible name overlap with the global continuable-child controls. Deleting them would either push Team tools into every shipped profile or leave the promoted packages with no supported way to mount.

**Leave the directories in place and rename only the npm packages.** Rejected: the release-family pattern, the experimental dependency rule, and the constraints gate all key on `packages/experimental/`, so an in-place rename would keep the packages excluded from publication while their names claimed release status.

**Fold the Team rows into `packages/bundle/base`.** Rejected for this step: it would change the default model-visible tool set for every mode, and the plan schedules that composition choice with the Maestro mode itself, after per-lane presets and worktree isolation exist.

## Consequences

- The gnk release pack and publish set now carry the five packages, and `scripts/release/families.spec.ts` asserts both halves of that: nothing under `packages/experimental/` is a member, and `@greeneek/gnk-agent-team` and `@greeneek/gnk-tool-agent-team` are.
- Release packages, apps, and the Python runtime may now take runtime dependencies on the Team packages, which is what the Maestro mode needs. Nothing does yet; the runtime-closure gate still passes with the current graph.
- The typert binding identifiers embed the npm name, so they moved from `@greeneek/gnk-experimental-agent-team#agentTeams/*` to `@greeneek/gnk-agent-team#agentTeams/*`. Host and generated Client face derive from the same manifest, so they stay consistent; a checkout that recorded the old identifier replays nothing, because the harness is pre-release and no durable format stores those ids.
- `[Incubating the family as private experimental packages](2026-08-18-experimental-agent-teams-packages.md)` remains the record of why the group exists and of the exclusion mechanism; its placement paragraphs for these five packages are superseded here, and the group still enforces them for `inspector`, `code-runtime-python`, `webworker-runtime`, and `webworker-packer`.
- Maestro G1 work now has an unblocked target: per-lane preset children, worktree isolation, the confirmation card, content-hash trust, and the benchmark scaffold land on release packages.

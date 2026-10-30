# Product inventory for desktop-v0.3.7

This inventory names every shipped surface group, the authoritative file that lists its members, and the evidence that exists for it on this release. It is deliberately a *group* inventory: the per-row membership lives in the generated catalogs, which the repository gates keep current (`pnpm run verify-generated-artifacts`), so a count copied here would rot while the catalogs stay correct.

Column meanings: **Evidence** names the newest proof that exists in this repository; **Disposition** is one of `verified` (implemented, tested, and exercised), `implemented` (code and tests exist, live exercise blocked), or `blocked` (named blocker, no claim).

## Conversations and session surfaces

| Surface | Members listed in | Evidence | Disposition |
|---|---|---|---|
| Conversation transcript, streaming, tool rows, reasoning rows, PTC cards | `packages/client/ui-chat`, `packages/client/ui-conversation` | `pnpm run test:gui`; recorded web scenarios under `apps/web/tests` | verified |
| Composer, mode pills, model and effort controls, attachments, steering, Emergency Stop | `packages/client/ui-chat` | `test:gui`; live dev-app pass in this release (see ledger) | verified |
| Sidebar, workspace browser, folding, rename, search rail | `packages/client/ui-sidebar`, `packages/client/ui-workspace` | `test:gui`; web scenarios `sidebar-*`, `workspace-*` | verified |
| Session lifecycle: create, resume, fork, rename, archive, delete, reload | `packages/api/session-controller`, `packages/api/workspace-controller` | `test:gui`; session snapshot corpus (`snapshots/session`, `snapshots/sdk`) | verified |
| Plan mode, goals, todos, background jobs | `packages/plan`, `packages/goal`, `packages/todo`, `packages/jobs` | package suites in `pnpm run test` | verified |
| Subagent and team lineage cards, child transcripts | `packages/client/ui-subagent`, `packages/subagent/*` | `test:gui`; `snapshots/sdk/subagent-*` | verified |

## Agent presets (modes)

| Preset | Listed in | Evidence | Disposition |
|---|---|---|---|
| `standard`, `army`, `maestro`, `pixels-designer`, `instructor`, `cordis` (Creator) | `packages/preset/agent-presets/presets/*/preset.yml` + `agent.cordis.yml` | `apps/cli/tests/preset-plugins.spec.ts` rejects a shipped preset whose packages are missing from the bundle closure; live dev-app pass switches all six | verified |
| `ptc` | same | `retired: true`; hidden from creation surfaces, explicit resume preserved (`packages/preset/agent-presets/tests`) | implemented — retirement marker only; deletion needs owner approval |
| Pixels Designer flagship export | `docs/flagships/pixels-designer.md` | five deterministic fixtures at the real Craft gateway | implemented — real PhotoCraft export blocked (no installed app, no key) |
| Instructor CV export | `docs/flagships/instructor.md` | rubric only | blocked — PdfCraft not installed, no key, no anti-fabrication proof |

## Settings destinations

Every section below is registered on the `settings.section` slot and reached through the full-page Settings destination (never a modal).

| Section | Registered by | Evidence | Disposition |
|---|---|---|---|
| General | `packages/client/ui-settings-general` | settings suites in `test:gui`; web scenario `settings-chrome` | verified |
| Models (providers, keys, custom models) | `packages/client/ui-settings-models` | `models-settings` web scenario | verified |
| Plugins (inspection, config write/discard/reset) | `packages/extensions/ui-cordis` | `plugin-config-*` web scenarios | verified |
| Agent presets (roster, authoring) | `packages/client/ui-agent-preset` | `preset-authoring-*`, `preset-selection` web scenarios | verified |
| Commands | `packages/interaction/*` | `command-menu-launcher` web scenario | verified |
| Fleet settings | `packages/client/ui-agent-team` | `ui-agent-team` suites; live dev-app pass renders provider availability and the favorites editor | verified |
| Apps setup (Craft) | `packages/client/ui-craft` | seven-state health tests; `ui-craft` suite | implemented — real app state blocked on the installed ArtCraft suite |
| About | `apps/desktop`, `packages/client/ui-settings` | desktop unit tests; `verify-desktop-version` gate | verified |

## Tools

| Surface | Members listed in | Evidence | Disposition |
|---|---|---|---|
| Model-visible tools (bash/pwsh, filesystem, web, skills, subagents, waves, goals, todos, plan, LSP, Craft, Cordis, jobs, terminal) | `docs/tool-catalog.md` (generated, gated) | per-package suites; `verify-tool-catalog` | verified |
| Tool UI presentations | `docs/cookbook/adding-a-tool.md` + `packages/client/ui-tool-*` | `test:gui`; recorded tool-row scenarios | verified |
| Delegation (`spawn_teammate`, `spawn_fleet`, `wave_dispatch`, lane tools) | `docs/subsystems/subagent.md`, `packages/subagent/agent-team` | `agent-team` and `tool-agent-team` suites at 100% coverage; three-lane integration scenario | verified |

## Integration and provider states

| Surface | Evidence | Disposition |
|---|---|---|
| LLM providers and models (catalog, selection, retry, fallback) | `packages/llm/*` suites; model-selection projection tests | verified |
| CLI providers (Claude Code, Codex) | `packages/subagent/subagent-claude-code`, `subagent-codex` suites | implemented — real CLI execution not exercised in this pass |
| Craft app discovery, health, drift, attach gate | `packages/craft/*` suites; `ARTCRAFT_SMOKE` serve smoke | implemented — serve smoke exits early without installed apps |
| ACP server | `packages/acp` suite; `snapshots/acp` | verified |
| SDK servers and clients (TypeScript, Python) | `snapshots/sdk`, `snapshots/python-sdk-single-exe` | verified |

## Permission and interaction surfaces

| Surface | Evidence | Disposition |
|---|---|---|
| Approval composer (fleet spend, tool escalation), question card, command menu | `test:gui`; `Approval`/`Question` web scenarios | verified |
| Permission presets and sandbox policy | `packages/interaction/permission-presets`, `packages/sandbox/*` suites | verified |
| Notifications: live regions, done reminders, job settle rows | `ui-wave` live-region tests, `ui-chat` suites | verified |

## Feature flags and per-session opt-ins

| Flag | Behaviour | Evidence | Disposition |
|---|---|---|---|
| PTC "Code tools" presentation (`presentAs('both')`) | Per-session opt-in, off by default | `packages/client/ui-chat` tests; PTC retirement note | verified |
| `ARTCRAFT_SMOKE` repository variable | Gates the real Craft serve smoke | `release-desktop.yml`, craft-local tests | verified |
| `GREENEEK_API_KEY` presence | Live lanes self-skip without it | `docs/testing.md` | verified |
| Dry-run dispatch (`dry_run`) | Builds and uploads without publishing | `scripts/ci-workflow.spec.ts` | verified |

## Dashboard

| Surface | Evidence | Disposition |
|---|---|---|
| Dashboard page (`sidebar.primary.action` + `dashboard` slot): session, workspace, running, delegated-session, turn, step, input/output/cache-read token totals; model, provider, and preset breakdowns; recent-session table; empty and partial states | `packages/client/ui-workspace/tests/dashboard-*` (188 tests in the package, 100% coverage on the three dashboard sources) | verified for recorded projections |
| Spend | `packages/client/ui-workspace/src/client/dashboard-pricing.ts` with an empty shipped catalog | implemented — honest `unknown` with a stated reason; see the pricing-provenance Agent Note |
| Unverified Dashboard remainder | live-agent and request counts, CLI/lane/outcome breakdowns, ranked most-used, operational-health rows, filterable paginated table, performance budget | blocked — named in plan item P2-09 |

## Known inventory gaps

- The 13-app ArtCraft matrix carries two evidenced rows (`pdfcraft`, `photocraft`) and the schema for the rest; the other eleven need the owner's app list and observed facts.
- Arabic review of critical flows is unreviewed by a native speaker; the automated parity and RTL passes are green.
- No performance budgets are recorded yet (startup readiness, long-session memory, Fleet latency, Dashboard aggregation, session-open time).

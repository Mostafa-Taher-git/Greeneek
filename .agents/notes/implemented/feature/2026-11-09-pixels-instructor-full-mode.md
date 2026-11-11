# Agent Note: Pixels Designer and Instructor as FULL modes through the Craft gateway (S5-10a/b/c)

Status: implemented

## Problem

Owner correction 1 ruled the Pixels Designer and Instructor presets wrong as implemented: each carried one flagship flow under a preview stub, while the owner requires full modes — Pixels for design, drafting, image editing, vector illustration, video editing, color and sound, motion graphics, page layout and publishing, and audio editing/mixing through the Craft apps; Instructor for roadmaps, explanations, tutorials, research, and complete CV creation/review/edit. The Master Release Plan records the work as S5-10a (Pixels flows), S5-10b (Instructor flows with operation-boundary anti-fabrication), S5-10c (five deterministic fixtures plus a stable rubric per mode at the real composition boundary), and S5-10d (preview-label removal only after real evidence).

## Decision

Both presets now describe every owner-named flow in the persona and route each through the existing Craft gateway seam (`craft_list_apps` before any app-specific promise, `craft_open_app` headless, per-app tools mounted only while the session is active). PhotoCraft backs the photo batch and image editing; PdfCraft backs poster/page layout, publishing, and the CV export. Flows whose dedicated app is not measured `ready` keep a specified honest-degrade path — the persona names the missing app and delivers the best workspace artifact the present tools can produce (drawing brief, edit decision list, mix plan, or markdown draft) and never claims an app ran. No parallel system was invented: discovery, launch, confinement, and artifact projection stay in `packages/craft/*`.

The Instructor anti-fabrication rule is enforced by a deterministic export gate, not by prompt advice alone. `evaluateCvTrace` requires every draft claim to map to user input or to a cited fetched fact (a fetched trace without a source URL is untraced); `cvExportDecision` allows export only for a traced draft with an explicit `approved` review, reports a rejected or pending review as returned to revision, and marks any PDF claim after a failed or absent export dishonest.

## Alternatives considered

**Synthesize manifests for vector/video/audio apps to "complete" the suite.** Rejected because the manifest provenance rule requires observed facts: a manifest for an unobserved app would invent launch templates, tool filters, and security posture. The gateway's measured-state contract is the source of truth; unmeasured apps degrade honestly instead.

**Hand-written per-app adapters for each flow.** Rejected because owner correction 2 and S5-09 define the gateway as auto-detect, and per-app adapters would duplicate the bridge's tool-filter and confinement logic. The persona routes through the gateway; recipes (`photocraft.md`, `pdfcraft.md`) carry the flow steps and mount only while the app session is active and its registry is reviewed.

**Prompt-only anti-fabrication.** Rejected because a prompt rule cannot be proven. The CV gate is a pure exported function in `@greeneek/gnk-craft` whose verdict the eval fixtures assert against the artifacts the composed agent produced.

## Reference ledger (Permanent engineering principles)

For every significant problem the plan requires root cause, a reference study, a reuse ledger, and Windows/Linux validation. The references were inspected at their `main` revisions (raw README surfaces, fetched 2026-11-09, which is the revision evidence the record cites):

- **PandaCode** (`aicodeking/pandacode`, README at `main`): a multi-harness workspace where the user picks harness, model, and reasoning effort per task from the composer and watches each turn as a card in a task sidebar. **Adoption: rejected as a structure, adopted as a pattern.** Greeneek already composes modes as layer compositions (presets) and lanes (Maestro); copying PandaCode's Tauri/Rust shell would duplicate the harness. The adopted pattern is that a mode is a profile over already-installed tools, capability is measured state, and the user always sees which profile is active — which is why this change mounts flows on the measured gateway instead of adding per-flow tool fan-outs.
- **T3 Code** (`pingdotgg/t3code`, README at `main`): a control surface over agents already installed and authenticated on the machine, with one provider adapter per CLI. **Adoption: rejected as a structure, adopted as a pattern.** Greeneek's control/test boundary is Cordis services, not a separate server; the adopted pattern is one adapter per platform behind a small contract plus an honestly reported availability state, which is exactly the `CraftHostProvider` + measured `CraftAppState` seam this change routes through.

No source was copied. The reuse decision is retain-and-adapt: keep the Craft gateway as the seam, add the CV gate beside the existing service, and keep flows as persona + recipe text so the gateway remains the only code path to an app.

## Consequences

Every owner-named flow in both modes has a specified gateway route and a specified degrade path, so a capability section can honestly show each app as ready, not-installed, or headless-only. The CV pipeline — questionnaire, traceable markdown draft, explicit review gate, PdfCraft export — cannot pass an untraced claim, a rejected review, or a failed export without the gate reporting it. Evaluations are deterministic and keyless: 14 unit cases for the gate, 5 Pixels and 5 Instructor fixtures at the real tool-registry/policy/confinement boundary with only `CraftTransport` faked, and 8 persona-contract fixtures pinning each owner's flow word in the shipped presets. Real-app evidence (recorded conversations and artifacts from installed ArtCraft apps) remains blocked on OWN-02/OWN-03 (S6-02/S6-03), so the preview label stays until S5-10d's evidence exists. Windows validation is recorded; Linux validation of the new fixtures runs on the CI lanes that own them.

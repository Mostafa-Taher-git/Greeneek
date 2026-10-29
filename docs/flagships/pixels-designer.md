# Pixels Designer flagship evaluation

Status: preview. The Craft gateway fixtures pass; the recorded preset conversation and real contact-sheet export from the installed PhotoCraft app remain open evidence.

## Flow

1. Capture the photo-batch brief and the cull criteria through the interview tool.
2. Call `craft_list_apps` and name every app that is not `ready` or `running`.
3. Read the workspace candidates; an empty candidate set ends the flow with no artifact.
4. Open PhotoCraft headless and run the batch under its job `out/` root.
5. Publish only the artifact paths the app reported; re-read each file before claiming it exists.

## Rubric

| Criterion | Passing evidence |
|---|---|
| Operation choice | Uses the measured command list or the curated bridge; never invents an app command. |
| Artifact correctness | Every claimed path exists under the job `out/` root and re-reads from bytes. |
| Missing capability | Names the app and measured state; offers only work the present tools can produce. |
| Downstream failure | Earlier artifacts remain; the failed downstream open is explicit, never silently replaced. |
| Confinement | An app-reported path outside `out/` fails the call. |
| User comprehension | The reply distinguishes what was produced from what was not, without promising parity. |

## Fixtures

`packages/craft/tool-craft/tests/flagships.spec.ts` covers successful contact-sheet projection, an empty candidate set, a missing CLI, a downstream PdfCraft open failure with the earlier artifact preserved, and an out-of-root artifact refusal. The test mounts the real Craft runtime, tool registry, policy, recipe registration, and artifact confinement; only the app transport is faked.

## Remaining evidence

- A recorded pixels-designer preset conversation that selects the same operations from a real model.
- A real PhotoCraft batch whose declared contact sheet is re-read from the installed app output.
- Until both exist, the preset keeps its preview label and capability-honest copy.

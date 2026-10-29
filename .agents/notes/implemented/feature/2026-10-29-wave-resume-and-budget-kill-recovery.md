# Agent Note: Wave resume admits a linked wave for the unfinished members of a budget-interrupted fleet

Status: implemented

## Problem

A budget kill ended a wave permanently. The fleet rows kept their `budget-killed` status and the Lead had to hand-compose an entire new wave — retyping every member spec and re-running members that had already completed — because the engine offered no way to continue an interrupted fleet, and the browser face offered no path forward at all.

## Decision

`WaveRuntime.resumeWave(waveId, budgets)` resumes one closed budget-interrupted wave: it admits a linked new wave carrying exactly the members that did not complete, in their original dispatch order and with their original specs, under the caller's new explicit token budgets. Completed members never rerun.

- **Eligibility is total and every refusal is typed.** The wave must still be retained, closed, not yet resumed, and have lost at least one member to a budget kill, and the caller must supply at least one explicit ceiling; each failure and the missing-budget case alike throw `WAVE_NOT_RESUMABLE`, an unretained id throws `WAVE_NOT_FOUND`, and provider or meter problems ride the shared admission checks (`NO_PROVIDER`, `BUDGET_METER_UNAVAILABLE`).
- **The resumed wave's budgets are exactly the caller's.** An unset ceiling is omitted from the new request, never inherited from the source — the per-member cap that just killed a member would otherwise immediately re-kill it on resume.
- **Admission is synchronous and is the commit point.** `resumeAdmission` validates, writes the linked wave's `wave/initiated` record (carrying `resumedFromWaveId`), and launches its members in one synchronous step; the source's `resumedToWaveId` mark publishes with the new wave's rows. A repeated call — mid-flight or after settlement — sees the mark and refuses, so one wave resumes at most once and two concurrent clicks cannot start two waves.
- **The Remote face answers the admission, not the settlement.** `waves.resume(waveId, maxTokensPerMember?, maxWaveTokens?)` returns `{ waveId }` immediately; the resumed wave's progress reaches the browser through the polled list face, and ineligible waves map to the typed `wave/not-resumable` code with `{ waveId }` details instead of a host throw.
- **The Fleet panel renders one resume card per eligible wave.** A closed wave with a budget-killed member and no resumed-to mark shows the exact remaining members and two budget fields; the action stays disabled until at least one positive integer is entered and while the admission is in flight, the answer becomes a notice line beside the card (zh/en/ar copy), and the card disappears once the view carries `resumedToWaveId`. The card lives in the shared panel body, so the composer pill's overlay offers it too. The `resumedToWaveId` field joins the fleet mirror's change signature, and the `resume` verb schedules the immediate sample the stop verbs already use.
- **The wave failure codes live in a zero-import module.** `src/remote-codes.ts` carries the `RemoteErrorDetailsMap` augmentation alone, and the browser face loads it there: the wave vocabulary module imports the seam's runtime types, and a client program that pulls them in silently flips the shared client typecheck's `Context.sessions` merge to the core session store's typing, breaking every controller-typed test in it. Do not fold these codes back into `src/types.ts` or `service.ts`.

## Alternatives considered

**Reviving members inside the settled wave record.** Rejected: each member's settlement record is written exactly once, and a second `wave/member-settled` row for the same member id would break the replay contract the durable records promise. A linked wave keeps every record's once-only claim intact.

**Awaiting settlement on the Remote face.** Rejected: a wave of sixteen members can run for minutes, and the click needs its acknowledgment at once; the polled list face already carries progress, so the admission id is the whole answer.

**Inheriting the source's budgets for unset fields.** Rejected: a resume that supplies only a wave budget would inherit the per-member ceiling that had just killed the member and re-kill it immediately.

## Consequences

- A resumed wave is a full wave: its own concurrency slots, its own metering, its own durable records, and its own result for the Lead's tool report.
- The resume is a same-process admission from the engine's retained map, not a log replay: a restart mid-wave still cancels members by teardown, and `resumedFromWaveId` serves the replayed log's picture of one interrupted run, not a restart recovery path.
- `WaveView.resumedToWaveId` is final once set, so a fleet surface never needs to poll for a second resume of the same wave.

## Verification

- The wave engine suite's resume block covers the linked-wave flow (unfinished-only members in dispatch order, original specs, `resumedFromWaveId` on the second `wave/initiated`, budget ceilings on the record), the rejections (not found, open wave, all-completed wave, no budgets, repeated click mid-flight and after settlement, meter unavailable), new budgets enforced on the resumed members, and the remote face's schema validation, error mapping, and immediate admission id.
- The fleet mirror suite pins the republish when `resumedToWaveId` lands and the resume verb's passthrough with its immediate resample; the panel suite pins the card's presence conditions, the disabled-until-budgeted action, the in-flight disable, the admission notice, the failure notice, and the card's disappearance once the mark arrives.
- Wave + tool-wave 96 tests, ui-wave 61 tests, `test:gui` 4197 passed / 1 skipped; typecheck and build:lib:host green; the cordis and persistence catalogs regenerated with the new methods and payload field.

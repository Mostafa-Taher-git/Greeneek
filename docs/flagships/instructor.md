# Instructor CV flagship evaluation

Status: blocked. PdfCraft is not installed on the owner host, no API key is available to record the preset conversation, and this repository has no operation-boundary CV claim contract yet. The Instructor preset keeps its preview label.

## Required flow

1. Interview for each CV section and keep every answer with its claim.
2. Draft Markdown where each claim maps to an answered field or a cited fetched fact; missing facts stay questions or visible placeholders.
3. Present the review checklist and require an affirmative sign-off.
4. Export through PdfCraft only after sign-off. A rejected review returns to revision.
5. If PdfCraft is unavailable or fails, keep the Markdown usable and state that no PDF exists.

## Rubric

| Criterion | Passing evidence |
|---|---|
| Factual traceability | Every claim maps to user input or a cited source; no inferred credentials, dates, or employers. |
| Missing data | Unanswered fields remain questions or explicit placeholders. |
| Review compliance | No export call before an affirmative review; a rejection returns to revision. |
| Export correctness | A PDF artifact exists and re-reads from bytes; failure leaves the Markdown usable and says no PDF exists. |
| User comprehension | The reply separates the Markdown draft from the PDF state. |

## Blockers

- **PdfCraft absent:** `T:\E\APPS\ArtCraft\PdfCraft\pdfcraft-cli.exe` does not exist, so the real Windows PDF proof cannot run.
- **No recorded model flow:** `GREENEEK_API_KEY` is not configured, so the preset conversation cannot be recorded for replay.
- **No boundary contract:** anti-fabrication is currently persona text; a claim-to-source gate must be designed before the fixture set can assert it in code.

The five fixtures (complete, sparse, conflicting, adversarial invention, rejected review plus failing export) should land with that boundary contract and the recorded flow, not as a simulation of them.

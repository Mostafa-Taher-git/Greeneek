/**
 * Deterministic CV export gate for the Instructor full-mode pipeline.
 *
 * The gate is a pure function over the draft's claims, their provenance
 * traces, and the user's review decision: every claim must map to user input
 * or to a cited fetched fact, export requires an explicit `approved` review,
 * and a failed export never licenses a PDF claim. The Instructor persona
 * instructs the agent to produce the claims and traces this gate reads; the
 * eval fixtures invoke the gate against the artifacts the composed agent
 * produced, so a draft the agent wrote cannot reach the PdfCraft export
 * without passing both checks.
 * @module @greeneek/gnk-craft/cv-gate
 */

import type {
  CvClaimTrace,
  CvExportGateInput,
  CvExportGateReport,
  CvTraceReport,
} from './types.ts'

/**
 * Normalize one claim for matching: trim and casefold so the draft and its
 * trace may differ in incidental whitespace or casing without producing a
 * false untraced claim.
 * @param text - raw claim or trace text.
 * @returns the normalized comparison key.
 */
function claimKey(text: string): string {
  return text.trim().toLowerCase()
}

/**
 * Trace every draft claim to its provenance.
 *
 * A claim is traced when a trace entry carries the same normalized text and,
 * for `fetched` sources, a non-empty source URL. A traced claim without a
 * URL is untraced: a fetched fact without its citation cannot be checked.
 * @param claims - claim texts as they appear in the draft.
 * @param traces - provenance entries the agent recorded for the draft.
 * @returns the trace report naming every untraced claim in draft order.
 */
export function evaluateCvTrace(
  claims: readonly string[],
  traces: readonly CvClaimTrace[],
): CvTraceReport {
  const valid = traces.filter(trace =>
    trace.source === 'user-input' || (trace.sourceUrl !== undefined && trace.sourceUrl.trim() !== ''),
  )
  const validKeys = new Set(valid.map(trace => claimKey(trace.claim)))
  const untracedClaims = claims.filter(claim => !validKeys.has(claimKey(claim)))
  return {
    ok: untracedClaims.length === 0,
    untracedClaims,
  }
}

/**
 * Decide whether the CV draft may be exported and whether any PDF claim is honest.
 *
 * Export requires `traceOk` and an explicit `approved` review; a rejected or
 * pending review returns to revision and cannot export. A failed export never
 * licenses a PDF claim, and a PDF claimed with no export attempt is dishonest
 * for the same reason. The first failing check names the reason.
 * @param input - trace result, review decision, export outcome, and PDF claim.
 * @returns the gate verdict.
 */
export function cvExportDecision(input: CvExportGateInput): CvExportGateReport {
  if (!input.traceOk) {
    return {
      mayExport: false,
      pdfClaimHonest: !input.pdfClaimed,
      reason: 'the draft contains claims with no user input or cited source; revise before export',
    }
  }
  if (input.reviewDecision !== 'approved') {
    return {
      mayExport: false,
      pdfClaimHonest: !input.pdfClaimed,
      reason: 'the user has not approved the draft; a rejected review returns to revision and cannot export',
    }
  }
  return {
    mayExport: true,
    pdfClaimHonest: input.exportOutcome !== 'succeeded' ? !input.pdfClaimed : true,
    reason: 'the draft is traced and approved; the PdfCraft export may proceed',
  }
}

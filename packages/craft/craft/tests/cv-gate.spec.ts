/**
 * Unit fixtures for the deterministic CV export gate: traceability of every
 * draft claim, the explicit review requirement, and the honesty of a PDF
 * claim after a failed or absent export.
 */

import { describe, expect, it } from 'vitest'
import { cvExportDecision, evaluateCvTrace } from '../src/cv-gate.ts'
import type { CvClaimTrace } from '../src/types.ts'

const TRACES: readonly CvClaimTrace[] = [
  { claim: 'Ada Lovelace, software engineer', source: 'user-input' },
  { claim: 'First programmer in history', source: 'fetched', sourceUrl: 'https://example.test/lovelace' },
]

describe('evaluateCvTrace', () => {
  it('passes a draft whose every claim maps to user input or a cited fetch', () => {
    expect(evaluateCvTrace(
      ['Ada Lovelace, software engineer', 'First programmer in history'],
      TRACES,
    )).toEqual({ ok: true, untracedClaims: [] })
  })

  it('matches claims across incidental whitespace and casing', () => {
    expect(evaluateCvTrace(
      ['  ADA LOVELACE, SOFTWARE ENGINEER '],
      TRACES,
    )).toEqual({ ok: true, untracedClaims: [] })
  })

  it('names every claim with no trace, in draft order', () => {
    expect(evaluateCvTrace(
      ['invented employer', 'Ada Lovelace, software engineer', 'invented degree'],
      TRACES,
    )).toEqual({ ok: false, untracedClaims: ['invented employer', 'invented degree'] })
  })

  it('treats a fetched trace without a source URL as untraced', () => {
    const traces: readonly CvClaimTrace[] = [
      { claim: 'First programmer in history', source: 'fetched' },
    ]
    expect(evaluateCvTrace(['First programmer in history'], traces))
      .toEqual({ ok: false, untracedClaims: ['First programmer in history'] })
  })

  it('treats a fetched trace with a blank source URL as untraced', () => {
    const traces: readonly CvClaimTrace[] = [
      { claim: 'First programmer in history', source: 'fetched', sourceUrl: '   ' },
    ]
    expect(evaluateCvTrace(['First programmer in history'], traces))
      .toEqual({ ok: false, untracedClaims: ['First programmer in history'] })
  })

  it('accepts an empty draft with no traces', () => {
    expect(evaluateCvTrace([], [])).toEqual({ ok: true, untracedClaims: [] })
  })
})

describe('cvExportDecision', () => {
  it('allows export for a traced draft with an approved review', () => {
    expect(cvExportDecision({
      traceOk: true,
      reviewDecision: 'approved',
      exportOutcome: 'not-attempted',
      pdfClaimed: false,
    })).toEqual({
      mayExport: true,
      pdfClaimHonest: true,
      reason: 'the draft is traced and approved; the PdfCraft export may proceed',
    })
  })

  it('refuses export for an untraced draft and calls a PDF claim dishonest', () => {
    expect(cvExportDecision({
      traceOk: false,
      reviewDecision: 'approved',
      exportOutcome: 'not-attempted',
      pdfClaimed: true,
    })).toEqual({
      mayExport: false,
      pdfClaimHonest: false,
      reason: 'the draft contains claims with no user input or cited source; revise before export',
    })
  })

  it('refuses export when the review was rejected, returning to revision', () => {
    expect(cvExportDecision({
      traceOk: true,
      reviewDecision: 'rejected',
      exportOutcome: 'not-attempted',
      pdfClaimed: false,
    })).toEqual({
      mayExport: false,
      pdfClaimHonest: true,
      reason: 'the user has not approved the draft; a rejected review returns to revision and cannot export',
    })
  })

  it('refuses export when the review is still pending', () => {
    const report = cvExportDecision({
      traceOk: true,
      reviewDecision: 'pending',
      exportOutcome: 'not-attempted',
      pdfClaimed: false,
    })
    expect(report.mayExport).toBe(false)
    expect(report.reason).toContain('has not approved')
  })

  it('refuses export when no review was requested', () => {
    const report = cvExportDecision({
      traceOk: true,
      reviewDecision: 'not-requested',
      exportOutcome: 'not-attempted',
      pdfClaimed: false,
    })
    expect(report.mayExport).toBe(false)
  })

  it('calls a PDF claim after a failed export dishonest', () => {
    expect(cvExportDecision({
      traceOk: true,
      reviewDecision: 'approved',
      exportOutcome: 'failed',
      pdfClaimed: true,
    })).toEqual({
      mayExport: true,
      pdfClaimHonest: false,
      reason: 'the draft is traced and approved; the PdfCraft export may proceed',
    })
  })

  it('keeps a failed export that claims no PDF honest', () => {
    expect(cvExportDecision({
      traceOk: true,
      reviewDecision: 'approved',
      exportOutcome: 'failed',
      pdfClaimed: false,
    }).pdfClaimHonest).toBe(true)
  })

  it('keeps a succeeded export that claims a PDF honest', () => {
    expect(cvExportDecision({
      traceOk: true,
      reviewDecision: 'approved',
      exportOutcome: 'succeeded',
      pdfClaimed: true,
    }).pdfClaimHonest).toBe(true)
  })
})

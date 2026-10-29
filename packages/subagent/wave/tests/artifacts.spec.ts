/**
 * Pure behavior of the engine's artifact-pointer gate: which raw claims from a
 * member's structured result are promoted, in what order, and which bounds
 * drop them.
 *
 * @module subagent-wave/tests/artifacts
 */

import { describe, expect, it } from 'vitest'
import { MAX_WAVE_ARTIFACTS, validateArtifacts } from '../src/artifacts.ts'

describe('validateArtifacts', () => {
  it('promotes valid file and uri pointers in the child\'s order', () => {
    expect(validateArtifacts([
      { kind: 'file', path: 'src/answer.ts' },
      { kind: 'uri', uri: 'https://example.com/report' },
    ])).toEqual([
      { kind: 'file', path: 'src/answer.ts' },
      { kind: 'uri', uri: 'https://example.com/report' },
    ])
  })

  it('returns no pointers from a non-array or empty value', () => {
    expect(validateArtifacts(undefined)).toEqual([])
    expect(validateArtifacts(null)).toEqual([])
    expect(validateArtifacts('src/a.ts')).toEqual([])
    expect(validateArtifacts({ kind: 'file', path: 'a.ts' })).toEqual([])
    expect(validateArtifacts([])).toEqual([])
  })

  it('drops entries that are not closed pointer-shaped objects', () => {
    expect(validateArtifacts([
      'src/a.ts',
      null,
      7,
      [],
      { kind: 'folder', path: 'src' },
      { kind: 'file', path: 'kept.txt', note: 'extra key drops the entry' },
      { kind: 'file' },
      { kind: 'uri' },
      { kind: 'file', path: 'kept.txt' },
    ])).toEqual([{ kind: 'file', path: 'kept.txt' }])
  })

  it('enforces the path bounds: present, bounded, printable', () => {
    expect(validateArtifacts([
      { kind: 'file', path: '' },
      { kind: 'file', path: 'x'.repeat(1025) },
      { kind: 'file', path: 'bad\u0000name.txt' },
      { kind: 'file', path: 'bad\u001Fname.txt' },
      { kind: 'file', path: 'bad\u007Fname.txt' },
      { kind: 'file', path: 42 },
      { kind: 'file', path: 'good.txt' },
    ])).toEqual([{ kind: 'file', path: 'good.txt' }])
    // A path of exactly the byte bound is kept, including multibyte text.
    const multibyte = 'é'.repeat(512)
    expect(validateArtifacts([{ kind: 'file', path: multibyte }])).toEqual([{ kind: 'file', path: multibyte }])
  })

  it('enforces the uri bounds: parseable absolute HTTP(S), bounded', () => {
    expect(validateArtifacts([
      { kind: 'uri', uri: '' },
      { kind: 'uri', uri: 'not a uri' },
      { kind: 'uri', uri: 'ftp://example.com/a' },
      { kind: 'uri', uri: 'javascript:alert(1)' },
      { kind: 'uri', uri: `https://example.com/${'x'.repeat(2100)}` },
      { kind: 'uri', uri: 42 },
      { kind: 'uri', uri: 'https://example.com/report' },
      { kind: 'uri', uri: 'http://example.com/plain' },
    ])).toEqual([
      { kind: 'uri', uri: 'https://example.com/report' },
      { kind: 'uri', uri: 'http://example.com/plain' },
    ])
  })

  it('keeps at most the documented count, first wins', () => {
    const flood = Array.from({ length: MAX_WAVE_ARTIFACTS + 5 }, (_, index) => ({
      kind: 'file',
      path: `out-${index}.txt`,
    }))
    const kept = validateArtifacts(flood)
    expect(kept).toHaveLength(MAX_WAVE_ARTIFACTS)
    expect(kept[MAX_WAVE_ARTIFACTS - 1]).toEqual({ kind: 'file', path: `out-${MAX_WAVE_ARTIFACTS - 1}.txt` })
    // Invalid entries do not consume the budget.
    expect(validateArtifacts([
      { kind: 'file', path: '' },
      ...flood,
    ])).toEqual(kept)
  })
})

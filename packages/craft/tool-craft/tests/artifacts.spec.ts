import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftError, craftRoots } from '@greeneek/gnk-craft'
import { projectCallResult, renderCallText } from '../src/artifacts.ts'

const ROOTS = craftRoots(join(process.cwd(), 'craft-artifacts-ws'))

describe('projectCallResult', () => {
  it('confines relative and absolute artifacts under the write root', () => {
    const projected = projectCallResult({
      content: [{ type: 'text', text: 'rendered' }],
      artifacts: ['preview.png', join(ROOTS.write, 'nested', 'page.pdf')],
    }, ROOTS)

    expect(projected.artifacts).toEqual([
      join(ROOTS.write, 'preview.png'),
      join(ROOTS.write, 'nested', 'page.pdf'),
    ])
    expect(projected.text).toBe(`rendered\n\nArtifacts:\n${join(ROOTS.write, 'preview.png')}\n${join(ROOTS.write, 'nested', 'page.pdf')}`)
  })

  it('fails loud when the app reports an escaping artifact', () => {
    expect(() => projectCallResult({
      content: [],
      artifacts: ['../escape.png'],
    }, ROOTS)).toThrow(CraftError)
    expect(() => projectCallResult({ content: [], artifacts: ['../../etc/passwd'] }, ROOTS))
      .toThrow(/escapes the job output root/)
  })

  it('keeps content blocks ordered and defaults a missing artifact list', () => {
    const projected = projectCallResult({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] }, ROOTS)
    expect(projected.artifacts).toEqual([])
    expect(projected.content).toEqual([{ type: 'text', text: 'a' }, { type: 'image' }])
    expect(projected.text).toBe('a\n[image content]')
  })
})

describe('renderCallText', () => {
  it('joins text blocks with newlines', () => {
    expect(renderCallText([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }], []))
      .toBe('one\ntwo')
  })

  it('describes non-text and unknown blocks', () => {
    expect(renderCallText([{ type: 'image' }, { text: 42 }, 'bare', null], []))
      .toBe('[image content]\n[unknown content]\n[unsupported app content block]\n[unsupported app content block]')
  })

  it('appends artifacts after the body', () => {
    expect(renderCallText([{ type: 'text', text: 'body' }], ['/out/a.png']))
      .toBe('body\n\nArtifacts:\n/out/a.png')
  })

  it('renders artifacts without a leading blank line when there is no body', () => {
    expect(renderCallText([], ['/out/a.png'])).toBe('Artifacts:\n/out/a.png')
  })

  it('reports a placeholder when there is neither text nor artifacts', () => {
    expect(renderCallText([], [])).toBe('(no output)')
  })
})

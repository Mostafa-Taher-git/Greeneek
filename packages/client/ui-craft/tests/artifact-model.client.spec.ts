/**
 * Artifact model spec: the durable result text is the only input — the
 * `Artifacts:` split, bullet/blank tolerance, first-line summaries, error-code
 * fallback, and separator-agnostic basenames.
 */
import { describe, expect, it } from 'vitest'
import type { ToolCallViewProps } from '@greeneek/gnk-client-ui-tool/client'
import { artifactModel, basename, parseArtifactPaths } from '../src/client/artifact/model.ts'

type Block = ToolCallViewProps['block']

function running(): Block {
  return {
    callId: 'c1',
    name: 'mcp__pdfcraft__render_preview',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 0,
    subCalls: [],
  }
}

function settled(
  content: readonly unknown[],
  options: { readonly isError?: boolean; readonly error?: { name: string; code: string } } = {},
): Block {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'mcp__pdfcraft__render_preview', argsRaw: '{}' },
    callTime: 0,
    content,
    isError: options.isError ?? false,
    ...(options.error === undefined ? {} : { error: options.error }),
    subCalls: [],
  } as Block
}

describe('parseArtifactPaths', () => {
  it('reads the trailing section, tolerating bullets and blank lines', () => {
    expect(parseArtifactPaths('Body\n\nArtifacts:\n- /out/a.pdf\n\n  /out/b.pdf  \n'))
      .toEqual(['/out/a.pdf', '/out/b.pdf'])
  })

  it('returns no artifacts without the marker', () => {
    expect(parseArtifactPaths('Just the app text')).toEqual([])
  })

  it('returns no artifacts when the marker closes the text', () => {
    expect(parseArtifactPaths('Body\nArtifacts:')).toEqual([])
  })
})

describe('basename', () => {
  it('takes the last segment on either separator', () => {
    expect(basename('/out/page-1.pdf')).toBe('page-1.pdf')
    expect(basename('C:\\job\\out\\page-1.pdf')).toBe('page-1.pdf')
    expect(basename('page-1.pdf')).toBe('page-1.pdf')
  })
})

describe('artifactModel', () => {
  it('is running with no artifacts until the call settles', () => {
    expect(artifactModel(running())).toEqual({ state: 'running', artifacts: [], summary: null })
  })

  it('projects the settled text body and confined artifacts', () => {
    const model = artifactModel(settled([
      { type: 'text', text: 'First line\nsecond line\n\nArtifacts:\n/out/a.pdf' },
    ]))
    expect(model).toEqual({ state: 'ok', artifacts: ['/out/a.pdf'], summary: 'First line' })
  })

  it('marks an error result and keeps its first text line', () => {
    const model = artifactModel(settled(
      [{ type: 'text', text: 'Overwrite refused' }],
      { isError: true, error: { name: 'CraftError', code: 'CRAFT_APP_ERROR' } },
    ))
    expect(model).toEqual({ state: 'error', artifacts: [], summary: 'Overwrite refused' })
  })

  it('summarizes a non-text block as JSON', () => {
    const model = artifactModel(settled([{ type: 'image', data: 'base64' }]))
    expect(model.summary).toBe('{')
  })

  it('has no summary when an empty result carried no error', () => {
    expect(artifactModel(settled([]))).toEqual({ state: 'ok', artifacts: [], summary: null })
  })

  it('falls back to the error identity when a failed result is empty', () => {
    expect(artifactModel(settled([], { isError: true, error: { name: 'CraftError', code: 'CRAFT_TRANSPORT_CLOSED' } })))
      .toEqual({ state: 'error', artifacts: [], summary: 'CraftError: CRAFT_TRANSPORT_CLOSED' })
  })
})

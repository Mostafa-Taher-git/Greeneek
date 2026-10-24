// @vitest-environment jsdom
/**
 * CraftArtifactRow state spec: the card reads only the durable call slice —
 * running, ok with confined artifact chips (click opens the full path), ok
 * with no artifacts, and a failed call whose app text stays readable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import type { ToolCallViewProps } from '@greeneek/gnk-client-ui-tool/client'
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import { CraftArtifactRow } from '../src/client/artifact/CraftArtifactRow.tsx'
import { zh } from '../src/client/locales.ts'

type Block = ToolCallViewProps['block']
type Props = ToolCallViewProps & PropsLocale<'craft'>

const t: Props['t'] = makeTranslate(zh, commonZh)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function runningBlock(): Block {
  return {
    callId: 'c1',
    name: 'mcp__photocraft__render_preview',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 0,
    subCalls: [],
  }
}

function settledBlock(
  text: string | null,
  options: { readonly isError?: boolean; readonly error?: { name: string; code: string } } = {},
): Block {
  const content = text === null ? [] : [{ type: 'text' as const, text }]
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'mcp__photocraft__render_preview', argsRaw: '{}' },
    callTime: 0,
    content,
    isError: options.isError ?? false,
    ...(options.error === undefined ? {} : { error: options.error }),
    subCalls: [],
  }
}

function bench(block: Block) {
  const openFile = vi.fn()
  render(<CraftArtifactRow {...({
    block,
    callId: 'c1',
    toolName: 'mcp__photocraft__render_preview',
    openFile,
    loadImage: () => Promise.resolve(''),
    t,
  } as unknown as Props)} />)
  return { openFile }
}

describe('CraftArtifactRow', () => {
  it('shows the rendering status while the call is still running', () => {
    bench(runningBlock())
    expect(screen.getByText('Craft 产物')).toBeTruthy()
    expect(screen.getByText('正在生成…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders one chip per confined artifact and opens the full path on click', () => {
    const { openFile } = bench(settledBlock(
      'Rendered page 1\n\nArtifacts:\n/workspace/job/out/page-1.pdf\n/workspace/job/out/page-2.pdf',
    ))
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
    expect(screen.getByText('2 个文件')).toBeTruthy()
    const chip = screen.getByRole('button', { name: '打开 page-1.pdf' })
    expect(chip.textContent).toBe('page-1.pdf')
    expect(chip.getAttribute('title')).toBe('/workspace/job/out/page-1.pdf')
    fireEvent.click(chip)
    expect(openFile).toHaveBeenCalledWith('/workspace/job/out/page-1.pdf')
  })

  it('renders the empty status when the call produced no artifacts', () => {
    bench(settledBlock('Saved the document'))
    expect(screen.getByText('Saved the document')).toBeTruthy()
    expect(screen.getByText('本次调用没有产物')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the failure status with the app text when the call failed', () => {
    bench(settledBlock('Overwrite refused by the app', { isError: true, error: { name: 'CraftError', code: 'CRAFT_APP_ERROR' } }))
    expect(screen.getByRole('alert').textContent).toBe('Craft 调用失败')
    expect(screen.getByText('Overwrite refused by the app')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('falls back to the error code when the failed call carried no content', () => {
    bench(settledBlock(null, { isError: true, error: { name: 'CraftError', code: 'CRAFT_APP_ERROR' } }))
    expect(screen.getByText('CraftError: CRAFT_APP_ERROR')).toBeTruthy()
  })
})

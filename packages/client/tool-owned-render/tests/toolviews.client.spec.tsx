// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ToolResultNode } from '@greeneek/gnk-client-ui-chat/client'
import type { ToolCallOwnerProps } from '@greeneek/gnk-client-ui-tool/client'
import { BashRow, MutationRow, ReadImageRow, ReadRow, SearchRow, WebRow } from '../src/client/toolviews.tsx'

afterEach(() => { cleanup() })

const noop = (): void => {}
const loadImage = async (): Promise<never> => { throw new Error('not used') }

const running = (toolName: string, argsRaw: string): ToolCallOwnerProps => ({
  callId: 'c1', toolName, openFile: noop, loadImage,
  block: { callId: 'c1', name: toolName, argsRaw, turn: 1, step: 1, time: 1000, subCalls: [] },
})

const settledProps = (toolName: string, node: Partial<ToolResultNode>): ToolCallOwnerProps => ({
  callId: 'c1',
  toolName, openFile: noop, loadImage,
  block: {
    kind: 'tool-result', seq: 1, time: 1000, callId: 'c1',
    call: { name: toolName, argsRaw: '{"path":"src/a.ts","command":"make","pattern":"x","url":"https://example.com","query":"q","file_path":"src/b.ts"}' },
    callTime: 500, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [], ...node,
  },
})

const rowProps = (props: ToolCallOwnerProps): Parameters<typeof ReadRow>[0] =>
  ({ ...props, t: (key: string) => key } as unknown as Parameters<typeof ReadRow>[0])

describe('tool-owned rows', () => {
  it('renders the running read row without output', () => {
    const view = render(<ReadRow {...rowProps(running('read', '{"path":"src/a.ts"}'))} />)
    expect(view.getByTestId('tool-owned-read').textContent).toContain('tool.title.read')
    expect(view.getByTestId('tool-owned-read').textContent).toContain('src/a.ts')
    expect(view.getByTestId('tool-owned-read').getAttribute('data-state')).toBe('running')
  })

  it('renders a settled read row with output', () => {
    const view = render(<ReadRow {...rowProps(settledProps('read', {}))} />)
    expect(view.getByTestId('tool-owned-read').textContent).toContain('done')
    expect(view.getByTestId('tool-owned-read').getAttribute('data-state')).toBe('ok')
  })

  it('renders read_image through the same primitives as read', () => {
    const view = render(<ReadImageRow {...rowProps(settledProps('read_image', {}))} />)
    expect(view.getByTestId('tool-owned-read_image').textContent).toContain('tool.title.readImage')
    expect(view.getByTestId('tool-owned-read_image').textContent).toContain('src/a.ts')
  })

  it('renders the bash row', () => {
    const view = render(<BashRow {...rowProps(settledProps('bash', {}))} />)
    expect(view.getByTestId('tool-owned-bash').textContent).toContain('tool.title.bash')
  })

  it('renders the write and edit rows', () => {
    const write = render(<MutationRow {...rowProps(settledProps('write', {}))} />)
    expect(write.getByTestId('tool-owned-write').textContent).toContain('tool.title.write')
    const edit = render(<MutationRow {...rowProps(settledProps('edit', {}))} />)
    expect(edit.getByTestId('tool-owned-edit').textContent).toContain('tool.title.edit')
  })

  it('renders the grep, glob, and web_search rows', () => {
    for (const tool of ['grep', 'glob', 'web_search'] as const) {
      const view = render(<SearchRow {...rowProps(settledProps(tool, {}))} />)
      expect(view.getByTestId(`tool-owned-${tool}`)).toBeTruthy()
    }
  })

  it('renders the web_fetch row', () => {
    const view = render(<WebRow {...rowProps(settledProps('web_fetch', {}))} />)
    expect(view.getByTestId('tool-owned-web_fetch').textContent).toContain('tool.title.webFetch')
  })
})

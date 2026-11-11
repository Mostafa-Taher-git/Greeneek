// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ToolResultNode } from '@greeneek/gnk-client-ui-chat/client'
import { deriveModel, resultText } from '../src/client/model.ts'

const settled = (overrides: Partial<ToolResultNode> = {}): ToolResultNode => ({
  kind: 'tool-result',
  seq: 1,
  time: 1000,
  callId: 'c1',
  call: { name: 'read', argsRaw: '{"path":"src/a.ts"}' },
  callTime: 500,
  content: [{ type: 'text', text: 'hello' }],
  isError: false,
  subCalls: [],
  ...overrides,
})

describe('deriveModel', () => {
  it('derives a running read summary from argsRaw', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: '{"path":"src/a.ts"}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.titleKey).toBe('tool.title.read')
    expect(model.summary).toBe('src/a.ts')
    expect(model.output).toBeNull()
    expect(model.state).toBe('running')
  })

  it('derives a settled bash output from content text blocks', () => {
    const model = deriveModel('bash', settled({
      call: { name: 'bash', argsRaw: '{"command":"make build"}' },
      content: [{ type: 'text', text: 'ok' }],
    }))
    expect(model.titleKey).toBe('tool.title.bash')
    expect(model.summary).toBe('make build')
    expect(model.output).toBe('ok')
    expect(model.state).toBe('ok')
  })

  it('falls back to the call id when argsRaw is empty', () => {
    const model = deriveModel('read', settled({ call: { name: 'read', argsRaw: '' } }))
    expect(model.summary).toBe('c1')
  })

  it('falls back to the call id when the settled call head is missing', () => {
    const model = deriveModel('read', settled({ call: null }))
    expect(model.summary).toBe('c1')
  })

  it('uses the first line of raw args when they are not JSON', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: 'not json\nsecond', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('not json')
  })

  it('uses the raw text when args decode to a non-object', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: 'null', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('null')
  })

  it('uses the raw text when a JSON array carries no string', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: '[]', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('[]')
  })

  it('uses the raw text when args carry no string value', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: '{"n":1}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('{"n":1}')
  })

  it('picks the first string value when the per-tool key is absent', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: '{"other":"fallback"}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('fallback')
  })

  it('joins web_search queries when present', () => {
    const model = deriveModel('web_search', { callId: 'c1', name: 'web_search', argsRaw: '{"queries":["first","second"]}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('first, second')
    expect(model.titleKey).toBe('tool.title.webSearch')
  })

  it('ignores an empty web_search queries array', () => {
    const model = deriveModel('web_search', { callId: 'c1', name: 'web_search', argsRaw: '{"queries":[],"query":"fallback"}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('fallback')
  })

  it('ignores a non-array web_search queries field', () => {
    const model = deriveModel('web_search', { callId: 'c1', name: 'web_search', argsRaw: '{"queries":"nope","query":"fallback"}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('fallback')
  })

  it('maps every owned tool to its title key', () => {
    const cases: [string, string][] = [
      ['read', 'tool.title.read'],
      ['read_image', 'tool.title.readImage'],
      ['bash', 'tool.title.bash'],
      ['write', 'tool.title.write'],
      ['edit', 'tool.title.edit'],
      ['grep', 'tool.title.grep'],
      ['glob', 'tool.title.glob'],
      ['web_search', 'tool.title.webSearch'],
      ['web_fetch', 'tool.title.webFetch'],
    ]
    for (const [tool, titleKey] of cases) {
      const model = deriveModel(tool, settled({ call: { name: tool, argsRaw: '{"path":"x"}' } }))
      expect(model.titleKey).toBe(titleKey)
    }
  })

  it('defaults an unknown tool to the read title', () => {
    expect(deriveModel('mystery', settled()).titleKey).toBe('tool.title.read')
  })

  it('reports interrupted settlements as stopped', () => {
    const model = deriveModel('bash', settled({
      call: { name: 'bash', argsRaw: '{"command":"make"}' },
      isError: true,
      error: { name: 'Interrupted', code: 'interrupted' },
      content: [],
    }))
    expect(model.state).toBe('stopped')
    expect(model.output).toBe('Interrupted: interrupted')
  })

  it('reports failed settlements as error', () => {
    const model = deriveModel('bash', settled({ isError: true, error: { name: 'E', code: 'boom' }, content: [] }))
    expect(model.state).toBe('error')
    expect(model.output).toBe('E: boom')
  })

  it('maps empty settled output to null', () => {
    expect(deriveModel('read', settled({ content: [] })).output).toBeNull()
  })

  it('flattens non-text content blocks as JSON', () => {
    const model = deriveModel('read', settled({ content: [{ type: 'image' } as never] }))
    expect(model.output).toBe(JSON.stringify({ type: 'image' }, null, 2))
  })

  it('truncates summaries at the first newline', () => {
    const model = deriveModel('read', { callId: 'c1', name: 'read', argsRaw: '{"path":"a\\nb"}', turn: 1, step: 1, time: 1000, subCalls: [] })
    expect(model.summary).toBe('a')
  })

  it('covers resultText directly', () => {
    expect(resultText(settled({ content: [] }))).toBe('')
    expect(resultText(settled({ content: [], error: { name: 'N', code: 'C' } }))).toBe('N: C')
  })
})

import { describe, expect, it } from 'vitest'
import { sessionMarkdown, type SessionMarkdownLabels } from '../src/client/markdown.ts'
import type { SessionEvent } from '@greeneek/gnk-session/types'

/** The headings the exported document uses. */
const labels: SessionMarkdownLabels = {
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool',
  result: 'Tool result',
}

/** One durable event of the shape the log carries. */
function event(type: string, data: unknown): SessionEvent {
  return { type, data } as unknown as SessionEvent
}

describe('sessionMarkdown', () => {
  it('renders the conversation, the tool calls, and their results', () => {
    const markdown = sessionMarkdown([
      event('session', { version: 0, id: 's1', createdAt: 0, cwd: '/proj' }),
      event('user/message', {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Ship the release.' }],
      }),
      event('assistant/message', {
        turn: 1,
        step: 2,
        message: {
          role: 'assistant',
          source: { kind: 'model', provider: 'greeneek-official', model: 'greeneek-v4-flash' },
          content: [{ type: 'text', text: 'On it.' }],
        },
      }),
      event('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"pwd"}' }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '/proj' }] }],
        },
      }),
    ], { title: 'Release notes', cwd: '/proj' }, labels)

    expect(markdown).toContain('# Release notes')
    expect(markdown).toContain('Workspace: `/proj`')
    expect(markdown).toContain('## User')
    expect(markdown).toContain('Ship the release.')
    expect(markdown).toContain('## Assistant')
    expect(markdown).toContain('On it.')
    expect(markdown).toContain('### Tool: bash')
    expect(markdown).toContain('{"command":"pwd"}')
    expect(markdown).toContain('### Tool result: bash')
    expect(markdown).toContain('/proj')
  })

  it('leaves injected context out of the transcript', () => {
    const markdown = sessionMarkdown([
      event('user/message', {
        role: 'user',
        source: { kind: 'plugin', plugin: 'skills' },
        content: [{ type: 'text', text: 'Skill content' }],
      }),
      event('user/message', {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Real question' }],
      }),
    ], {}, labels)

    expect(markdown).not.toContain('Skill content')
    expect(markdown).toContain('Real question')
  })

  it('names an untitled session and truncates a noisy tool result', () => {
    const markdown = sessionMarkdown([
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'x'.repeat(9_000) }] }],
        },
      }),
    ], {}, labels)

    expect(markdown).toContain('# Session')
    expect(markdown).toContain('… (truncated)')
    expect(markdown.length).toBeLessThan(6_000)
  })
})

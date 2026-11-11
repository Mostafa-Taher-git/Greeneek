import { describeAdapterConformance, assertChunkProtocol } from '@greeneek/gnk-llm/conformance'
import { LlmAdapter, ToolCallId } from '@greeneek/gnk-llm'
import type { GenerateOptions, StreamChunk } from '@greeneek/gnk-llm'
import type { LlmResolvedModelInfo } from '@greeneek/gnk-llm'
import { describe, expect, it } from 'vitest'

/**
 * Scripted mock adapter: text turns, tool turns, and abort behavior chosen
 * by model id, so the kit's four cases each get a protocol-correct stream
 * without any HTTP endpoint.
 */
class MockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      return
    }
    if (options.model === 'conformance-tool-model') {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), name: 'echo', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'echo', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hello' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describeAdapterConformance('@greeneek/gnk-llm (mock)', async () => ({ adapter: new MockAdapter() }))

describe('conformance chunk protocol', () => {
  it('rejects deltas after block-end', () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'a' } },
      { type: 'text-delta', index: 0, text: 'late' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    expect(() => { assertChunkProtocol(chunks) }).toThrow('already-ended')
  })

  it('rejects a second finish and a second usage', () => {
    const twoFinish: StreamChunk[] = [
      { type: 'finish', reason: { kind: 'stop' } },
      // Second finish is also "chunk after finish"; either throw suffices.
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    expect(() => { assertChunkProtocol(twoFinish) }).toThrow()
    const twoUsage: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    expect(() => { assertChunkProtocol(twoUsage) }).toThrow('more than once')
  })
})

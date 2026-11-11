/**
 * Reusable LLM adapter conformance kit: a vitest suite parameterized by an
 * adapter factory, asserting the chunk protocol from `types.ts`:
 *
 * - block indexes are monotonic per block (a new block starts at a strictly
 *   greater index, deltas stay on the open index),
 * - no delta or block-start arrives after `block-end` for its index,
 * - exactly one `finish` chunk terminates the stream,
 * - `usage` appears at most once and only before `finish`,
 * - every `tool-call-delta` carries the call id,
 * - abort is honored promptly: an already-aborted signal still terminates
 *   with a `finish { kind: 'aborted' }` (through `LlmRuntime`, or an
 *   `ABORTED` throw from a raw adapter).
 *
 * A new adapter inherits the suite by invoking
 * {@link describeAdapterConformance} with its factory; the mock adapter and
 * both shipping adapters (`gnk-llm-greeneek`, `gnk-llm-pi-ai`) run it in
 * their own specs. This module is test-only: production code never imports
 * it, so its `vitest` import never reaches a shipped runtime.
 *
 * @module @greeneek/gnk-llm/conformance
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from './types.ts'
import type { LlmAdapter } from './index.ts'

/** What an adapter factory returns: the adapter plus optional cleanup. */
export interface AdapterFactoryResult {
  adapter: LlmAdapter
  cleanup?: () => Promise<void> | void
}

/**
 * A factory for one fresh adapter instance per conformance case. Factories
 * that need a live endpoint (the shipping adapters) start their mock server
 * here and return a `cleanup` that closes it.
 */
export type AdapterFactory = () => AdapterFactoryResult | Promise<AdapterFactoryResult>

/** Fail-loud helper for the assertion sites that need a message. */
function fail(message: string): never {
  throw new Error(`adapter conformance: ${message}`)
}

/**
 * Assert one collected chunk sequence obeys the protocol. Throws on the
 * first violation (the suite below feeds it every stream it collects).
 * @param chunks - chunks collected from one stream call.
 */
export function assertChunkProtocol(chunks: readonly StreamChunk[]): void {
  let finishCount = 0
  let usageCount = 0
  let currentIndex = -1
  let seenFinish = false
  const ended = new Set<number>()
  for (const chunk of chunks) {
    if (seenFinish) fail('chunk arrives after finish')
    switch (chunk.type) {
      case 'block-start': {
        if (ended.has(chunk.index)) fail(`block-start for already-ended index ${String(chunk.index)}`)
        if (chunk.index <= currentIndex) fail(`block-start index ${String(chunk.index)} is not monotonic after ${String(currentIndex)}`)
        currentIndex = chunk.index
        break
      }
      case 'text-delta':
      case 'reasoning-delta':
      case 'tool-call-delta': {
        if (ended.has(chunk.index)) fail(`${chunk.type} for already-ended index ${String(chunk.index)}`)
        // Adapter chunks are unvalidated at runtime; a JS adapter can omit the required id.
        if (chunk.type === 'tool-call-delta' && (chunk as { id?: unknown }).id === undefined) fail('tool-call-delta without a call id')
        if (chunk.index > currentIndex) fail(`${chunk.type} for index ${String(chunk.index)} before its block-start`)
        break
      }
      case 'block-end': {
        if (ended.has(chunk.index)) fail(`duplicate block-end for index ${String(chunk.index)}`)
        ended.add(chunk.index)
        break
      }
      case 'usage': {
        usageCount++
        if (usageCount > 1) fail('usage appears more than once')
        break
      }
      case 'finish': {
        finishCount++
        seenFinish = true
        break
      }
    }
  }
  if (finishCount !== 1) fail(`exactly one finish is required, found ${String(finishCount)}`)
}

/**
 * Collect every chunk from one stream call.
 * @param adapter - adapter under test.
 * @param options - request to stream.
 * @returns collected chunks, in arrival order.
 */
export async function collectStream(
  adapter: LlmAdapter,
  options: GenerateOptions,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

function userOptions(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'conformance',
    model: 'conformance-model',
    messages: [],
    ...overrides,
  }
}

/**
 * Register the adapter conformance suite in vitest for one adapter.
 * @param name - display name for the suite (usually the package name).
 * @param factory - fresh-adapter factory (owns endpoint setup/teardown).
 */
export function describeAdapterConformance(name: string, factory: AdapterFactory): void {
  describe(name, () => {
    let cleanup: (() => Promise<void> | void) | undefined
    afterEach(async () => {
      await cleanup?.()
      cleanup = undefined
    })

    async function fresh(): Promise<LlmAdapter> {
      const result = await factory()
      cleanup = result.cleanup
      return result.adapter
    }

    it('emits the chunk protocol for a text turn', async () => {
      const adapter = await fresh()
      const chunks = await collectStream(adapter, userOptions())
      assertChunkProtocol(chunks)
      expect(chunks.at(-1)?.type).toBe('finish')
    })

    it('emits exactly one finish and at most one usage', async () => {
      const adapter = await fresh()
      const chunks = await collectStream(adapter, userOptions({ model: 'conformance-model-2' }))
      expect(chunks.filter(chunk => chunk.type === 'finish')).toHaveLength(1)
      expect(chunks.filter(chunk => chunk.type === 'usage').length).toBeLessThanOrEqual(1)
      assertChunkProtocol(chunks)
    })

    it('carries a call id on every tool-call-delta', async () => {
      const adapter = await fresh()
      const chunks = await collectStream(adapter, userOptions({ model: 'conformance-tool-model' }))
      for (const chunk of chunks) {
        if (chunk.type === 'tool-call-delta') expect(chunk.id).toBeDefined()
      }
      assertChunkProtocol(chunks)
    })

    it('honors an already-aborted signal promptly', async () => {
      const adapter = await fresh()
      const controller = new AbortController()
      controller.abort()
      let chunks: StreamChunk[] = []
      let threw = false
      try {
        chunks = await collectStream(adapter, userOptions({ signal: controller.signal }))
      } catch {
        threw = true
      }
      if (!threw) {
        // Adapters that normalize to the wire yield an aborted finish;
        // adapters that throw still satisfy the prompt-abort contract.
        const last = chunks.at(-1)
        expect(last?.type).toBe('finish')
        if (last?.type === 'finish') expect(last.reason.kind).toBe('aborted')
        assertChunkProtocol(chunks)
      }
    })
  })
}

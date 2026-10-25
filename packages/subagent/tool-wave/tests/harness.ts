/**
 * Boot the real stack the fleet tools consume — subagent registry, session
 * projections, token meter, the wave engine, system prompt, and tool
 * registry — and drive the registered tools through `ctx.tools.execute` the
 * way the agent loop does.
 *
 * @module tool-wave/tests/harness
 */

import { afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import { ToolCallId } from '@greeneek/gnk-llm'
import { Session, SessionId } from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import SubagentRuntime from '@greeneek/gnk-subagent'
import type { SubagentResult, SubagentRun } from '@greeneek/gnk-subagent'
import type { ResolvedSubagentStartRequest, SubagentCapabilities, SubagentProvider } from '@greeneek/gnk-subagent'
import type { WaveRuntimeConfig } from '@greeneek/gnk-subagent-wave'
import WaveRuntime from '@greeneek/gnk-subagent-wave'
import SystemPrompt from '@greeneek/gnk-system-prompt'
import ToolRuntime from '@greeneek/gnk-tools'
import TokenMeter from '@greeneek/gnk-token-meter'
import * as toolWave from '../src/index.ts'

/** Contexts created by one test file; every afterEach runs them down. */
const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(async (ctx) => { await ctx.fiber.dispose() }))
  contexts.clear()
})

export type ControlledRun = SubagentRun & {
  readonly deferred: PromiseWithResolvers<SubagentResult>
  readonly dispose: Mock<() => Promise<void>>
}

/** Provider whose publication is immediate and whose result and disposal are test-controlled. */
export class ControlledProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: true,
  }
  readonly inheritsParentContext = false
  readonly requests: ResolvedSubagentStartRequest[] = []
  readonly runs: ControlledRun[] = []

  constructor(readonly name = 'controlled', readonly abortOutcome: 'resolve' | 'reject' = 'resolve') {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const deferred = Promise.withResolvers<SubagentResult>()
    const id = SessionId(`${this.name}-child-${this.runs.length}`)
    const dispose = vi.fn(async (): Promise<void> => {})
    const run: ControlledRun = { id, localAgent: undefined, result: deferred.promise, deferred, dispose }
    const onAbort = (): void => {
      if (this.abortOutcome === 'reject') {
        deferred.reject(new Error(`${this.name} rejected after abort`))
        return
      }
      deferred.resolve({ output: [], stopReason: 'aborted' })
    }
    if (request.signal.aborted) {
      onAbort()
    } else {
      request.signal.addEventListener('abort', onAbort, { once: true })
    }
    void deferred.promise.then(() => {
      request.signal.removeEventListener('abort', onAbort)
    })
    this.requests.push(request)
    this.runs.push(run)
    return Promise.resolve(run)
  }
}

/** The mounted stack one dispatch/cancel test runs against. */
export interface WaveToolHarness {
  readonly ctx: Context
  readonly waves: WaveRuntime
  readonly provider: ControlledProvider
  /** The registered second provider a member's `provider` can override onto. */
  readonly alternate: ControlledProvider | undefined
  readonly parent: Agent
}

/** Calling Agents minted per harness; stored so `callTool` can default to one. */
const setupParents = new WeakMap<Context, Agent>()

/**
 * Mount the real registries, the wave engine, the tool runtime, and the
 * fleet tools on one fresh context.
 * @param config - the wave engine's concurrency and result-cap config.
 * @param options - whether to register an alternate provider, and the parent session id.
 * @returns the harness parent plus every seam the tests assert across.
 */
export async function setupWaveTool(
  config: WaveRuntimeConfig = {},
  options: { readonly alternate?: boolean; readonly parentId?: string } = {},
): Promise<WaveToolHarness> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(WaveRuntime, config)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const provider = new ControlledProvider('controlled')
  ctx.subagents.registerProvider(provider)
  const alternate = options.alternate === true ? new ControlledProvider('alternate') : undefined
  if (alternate !== undefined) ctx.subagents.registerProvider(alternate)
  await ctx.plugin(toolWave, { provider: 'controlled' })
  const parent = fakeAgent(options.parentId ?? 'wave-tool-parent')
  setupParents.set(ctx, parent)
  return { ctx, waves: ctx.waves, provider, alternate, parent }
}

/** Build the minimal calling Agent: a real session owned by nothing else. */
export function fakeAgent(id: string): Agent {
  const sessionId = SessionId(id)
  return { id: sessionId, options: {}, session: Session.create(sessionId) } as unknown as Agent
}

let toolCallCounter = 0

/**
 * Execute one registered fleet tool through the real ToolRuntime pipeline.
 * @param ctx - the harness context.
 * @param name - the registered tool name.
 * @param args - model arguments.
 * @param over - overrides; an explicit `{ agent: undefined }` skips the field
 *   entirely (under `exactOptionalPropertyTypes` the key is omitted, not set),
 *   which tests the no-agent path.
 * @returns the executed result.
 */
export function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  over: { agent?: Agent | undefined } = {},
) {
  const agent = 'agent' in over ? over.agent : setupParents.get(ctx)
  return ctx.tools.execute({
    // Every call models the loop-owned cancellation channel separately.
    signal: new AbortController().signal,
    callId: ToolCallId(`tool-wave-call-${++toolCallCounter}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

/** The published child Agent of one member run, for wave metering drives. */
export function childAgent(run: SubagentRun): Agent {
  const session = Session.create(run.id)
  return { id: run.id, session } as unknown as Agent
}

/** Drive the real waterfall with only the agent field relevant to wave metering. */
export function preStep(ctx: Context, agent: Agent): Promise<unknown> {
  return ctx.waterfall(
    'agent/pre-step',
    { agent, messages: [], turn: 0, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

/** A token-usage projection state the budget tests can hand to `stateOf`. */
export function usage(tokens: number) {
  return {
    totals: {
      uncachedInputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    last: null,
  }
}

/** A completed child result, with an optional structured value. */
export function completed(text = 'done', structured?: unknown): SubagentResult {
  return {
    output: [{ type: 'text', text }],
    ...(structured === undefined ? {} : { structured }),
    stopReason: 'completed',
  }
}

/** The `wave/*` record types on one Lead's log, in append order. */
export function waveEventTypes(parent: Agent): readonly string[] {
  return parent.session.snapshotEvents()
    .filter(event => event.type.startsWith('wave/'))
    .map(event => event.type)
}

/** Join the text blocks of one rendered tool result. */
export function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}
